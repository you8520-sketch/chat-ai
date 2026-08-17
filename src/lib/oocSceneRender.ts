/**
 * Orthogonal OOC scene-render / canonicality owner.
 *
 * ChatOocIntent remains RP-control semantics (none / continuing / reset /
 * unrelated / hard_stop). This module only answers: is this generation a
 * noncanonical sample/IF scene that must not mutate main RP state?
 *
 * Regex lives here only. Downstream code must read structured
 * generationKind / canonical metadata.
 */

import type Database from "better-sqlite3";
import {
  classifyChatOocIntent,
  extractOocRoutingText,
  messageHasOocMarkers,
} from "@/lib/chatOocPriority";
import { extractOocSnippets } from "@/lib/userImpersonationPolicy";

export const OOC_SCENE_RENDER_GENERATION_KIND = "ooc_scene_render" as const;
export const CANONICAL_GENERATION_KIND = "canonical" as const;

export type GenerationKind =
  | typeof OOC_SCENE_RENDER_GENERATION_KIND
  | typeof CANONICAL_GENERATION_KIND;

export type GenerationSemantics = {
  generationKind: GenerationKind;
  canonical: boolean;
  canonAdopted?: boolean;
  canonAdoptedAt?: string;
};

export type CanonAdoption = {
  canonAdopted: boolean;
  canonAdoptedAt?: string;
};

export const CANONICAL_GENERATION_SEMANTICS: GenerationSemantics = {
  generationKind: CANONICAL_GENERATION_KIND,
  canonical: true,
};

export const OOC_SCENE_RENDER_SEMANTICS: GenerationSemantics = {
  generationKind: OOC_SCENE_RENDER_GENERATION_KIND,
  canonical: false,
};

export const OOC_CANON_ADOPTION_COPY = {
  title: "이 장면을 본편에 반영할까요?",
  description:
    "반영하면 이후 대화와 기억에서 실제로 일어난 사건으로 취급되며, 다음 대화는 이 장면 직후부터 이어집니다. 반영하지 않으면 비정사 장면으로 유지됩니다.",
  keepNoncanonical: "비정사로 유지",
  adopt: "본편에 반영",
  adoptedBadge: "본편에 반영됨",
  deleteProtected: "이 장면은 본편에 반영되어 있습니다.",
  regenBlocked: "본편에 반영된 장면은 재생성할 수 없습니다.",
  variantSwitchBlocked: "본편에 반영된 장면은 다른 버전으로 바꿀 수 없습니다.",
} as const;

const FINALIZED_SUCCESS_STATUSES = new Set([
  "completed",
  "ok",
  "completed_with_postprocess_error",
]);

const STRONG_ISOLATION =
  /본편과\s*별개|본편과\s*무관|RP와\s*별개|알피와\s*별개|(?:RP|알피|본편)에(?:는)?\s*반영하지|기억(?:이나|\/|과)?\s*설정에(?:는)?\s*반영하지|실제\s*진행은\s*아니|비정사로|샘플\s*장면|예시\s*장면|가정\s*상황으로|IF\s*상황으로/i;

const WEAK_ISOLATION =
  /가정하면|만약|샘플|예시|가정\s*상황|반영하지\s*마|비정사|정사\s*아님|what[\s-]*if/i;

const RENDER_SIGNAL =
  /한\s*장면\s*(?:보여|써|묘사)|장면으로\s*(?:써|보여|출력|묘사)|한\s*번\s*(?:써|보여|묘사)|어떻게\s*되는지\s*보여|반응을\s*장면으로|상황을\s*출력|장면을\s*(?:써|보여|출력)|(?:장면|상황|반응|경우).{0,24}(?:써줘|보여줘|묘사해줘|출력해줘)|(?:써줘|보여줘|묘사해줘|출력해줘).{0,16}(?:장면|상황)/i;

const CURRENT_RP_CONTINUATION =
  /지금\s*장면|이대로\s*계속|계속\s*진행|여기서\s*.{0,20}진행|좀\s*더\s*.{0,16}진행|현재\s*상황에서.{0,20}이어|이어가|능글맞게\s*진행/i;

export function collectOocSceneRenderScanText(userMessage: string): string {
  const trimmed = userMessage.trim();
  if (!trimmed) return "";
  const snippets = extractOocSnippets(trimmed);
  const routing = extractOocRoutingText(trimmed);
  if (snippets.length > 0) {
    return [...snippets, routing].filter(Boolean).join("\n");
  }
  return routing;
}

function countMatches(re: RegExp, text: string): number {
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  return text.match(global)?.length ?? 0;
}

/**
 * Fail-closed: isolation + render required. Scene-reset / hard-stop / current-RP
 * continuation without strong isolation stay on existing OOC/RP semantics.
 */
export function resolveOocSceneRenderIntent(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed || !messageHasOocMarkers(trimmed)) return false;

  const intent = classifyChatOocIntent(trimmed);
  if (intent === "rp_scene_reset" || intent === "rp_hard_stop") return false;

  const scan = collectOocSceneRenderScanText(trimmed);
  if (!scan) return false;

  const strong = countMatches(STRONG_ISOLATION, scan);
  const weak = countMatches(WEAK_ISOLATION, scan);
  const render = RENDER_SIGNAL.test(scan);
  if (!render) return false;
  if (CURRENT_RP_CONTINUATION.test(scan) && strong === 0) return false;
  if (strong >= 1) return true;
  if (weak >= 2) return true;
  return false;
}

export function resolveGenerationSemantics(input: {
  userMessage: string;
  inherited?: GenerationSemantics | null;
}): GenerationSemantics {
  if (input.inherited?.generationKind === OOC_SCENE_RENDER_GENERATION_KIND) {
    return OOC_SCENE_RENDER_SEMANTICS;
  }
  return resolveOocSceneRenderIntent(input.userMessage)
    ? OOC_SCENE_RENDER_SEMANTICS
    : CANONICAL_GENERATION_SEMANTICS;
}

export function isOocSceneRenderSemantics(
  value: GenerationSemantics | null | undefined
): boolean {
  return value?.generationKind === OOC_SCENE_RENDER_GENERATION_KIND && value.canonical === false;
}

export function shouldCommitCanonicalTurnState(
  semantics: GenerationSemantics | null | undefined
): boolean {
  return !isOocSceneRenderSemantics(semantics);
}

function originOocSemantics(adoption: CanonAdoption): GenerationSemantics {
  if (!adoption.canonAdopted) return OOC_SCENE_RENDER_SEMANTICS;
  return {
    generationKind: OOC_SCENE_RENDER_GENERATION_KIND,
    canonical: false,
    canonAdopted: true,
    ...(adoption.canonAdoptedAt ? { canonAdoptedAt: adoption.canonAdoptedAt } : {}),
  };
}

export function readCanonAdoption(usage: unknown): CanonAdoption {
  const record = parseUsageObject(usage);
  if (!record) return { canonAdopted: false };
  return readCanonAdoptionFromRecord(record);
}

function readCanonAdoptionFromRecord(record: Record<string, unknown>): CanonAdoption {
  if (record.canonAdopted !== true) return { canonAdopted: false };
  return {
    canonAdopted: true,
    ...(typeof record.canonAdoptedAt === "string" && record.canonAdoptedAt.trim()
      ? { canonAdoptedAt: record.canonAdoptedAt }
      : {}),
  };
}

export function readGenerationSemantics(usage: unknown): GenerationSemantics | null {
  const record = parseUsageObject(usage);
  if (!record) return null;
  const adoption = readCanonAdoptionFromRecord(record);
  if (record.generationKind === OOC_SCENE_RENDER_GENERATION_KIND) {
    return originOocSemantics(adoption);
  }
  if (record.generationKind === CANONICAL_GENERATION_KIND || record.canonical === true) {
    return CANONICAL_GENERATION_SEMANTICS;
  }
  if (record.canonical === false) return originOocSemantics(adoption);
  return null;
}

export function isOriginOocSceneRender(usage: unknown): boolean {
  return readGenerationSemantics(usage)?.generationKind === OOC_SCENE_RENDER_GENERATION_KIND;
}

export function isCanonAdoptedScene(usage: unknown): boolean {
  const semantics = readGenerationSemantics(usage);
  return isOocSceneRenderSemantics(semantics) && semantics?.canonAdopted === true;
}

export function isEffectiveCanonEvent(usage: unknown): boolean {
  const semantics = readGenerationSemantics(usage);
  if (!semantics) return true;
  if (semantics.canonical === true) return true;
  return isCanonAdoptedScene(usage);
}

export function isNoncanonicalGeneration(usage: unknown): boolean {
  return isOriginOocSceneRender(usage) && !isCanonAdoptedScene(usage);
}

export function isCanonicalGeneration(usage: unknown): boolean {
  const semantics = readGenerationSemantics(usage);
  if (!semantics) return true;
  return semantics.canonical === true;
}

export function readOocSceneClientFlags(usage: unknown): {
  oocSceneRender: boolean;
  canonAdopted: boolean;
} {
  return {
    oocSceneRender: isOriginOocSceneRender(usage),
    canonAdopted: isCanonAdoptedScene(usage),
  };
}

export function isOocSceneAdoptionPromptEligible(input: {
  role?: string | null;
  oocSceneRender?: boolean;
  canonAdopted?: boolean;
  generationStatus?: string | null;
  content?: string | null;
}): boolean {
  if (input.role != null && input.role !== "assistant") return false;
  if (!input.oocSceneRender || input.canonAdopted) return false;
  if (!String(input.content ?? "").trim()) return false;
  const status = (input.generationStatus ?? "completed").toLowerCase();
  if (status === "generating" || status === "submitted") return false;
  if (status === "failed" || status === "failed_partial" || status === "interrupted") {
    return false;
  }
  return FINALIZED_SUCCESS_STATUSES.has(status);
}

export function mergeGenerationSemantics<T extends object>(
  usage: T,
  semantics: GenerationSemantics
): T & GenerationSemantics {
  const existingAdoption = readCanonAdoption(usage);
  const adopted = semantics.canonAdopted === true || existingAdoption.canonAdopted;
  const adoptedAt =
    semantics.canonAdopted === true
      ? semantics.canonAdoptedAt ?? existingAdoption.canonAdoptedAt
      : existingAdoption.canonAdoptedAt;
  return {
    ...usage,
    generationKind: semantics.generationKind,
    canonical: semantics.canonical,
    ...(adopted
      ? {
          canonAdopted: true as const,
          ...(adoptedAt ? { canonAdoptedAt: adoptedAt } : {}),
        }
      : {}),
  };
}

export function nextPersistedModelRouteState<T>(
  previous: T,
  advanced: T,
  semantics: GenerationSemantics | null | undefined
): T {
  return shouldCommitCanonicalTurnState(semantics) ? advanced : previous;
}

export type CanonicalMessageRow = {
  id?: number | null;
  role: string;
  content?: string | null;
  model?: string | null;
  user_message_id?: number | null;
  usage?: unknown;
};

function rowId(row: CanonicalMessageRow): number | null {
  return Number.isSafeInteger(row.id) && Number(row.id) > 0 ? Number(row.id) : null;
}

function linkedUserId(row: CanonicalMessageRow): number | null {
  return Number.isSafeInteger(row.user_message_id) && Number(row.user_message_id) > 0
    ? Number(row.user_message_id)
    : null;
}

function isOriginOocUserRow(row: CanonicalMessageRow): boolean {
  return (
    isOriginOocSceneRender(row.usage) ||
    (row.role === "user" && resolveOocSceneRenderIntent(row.content ?? ""))
  );
}

/**
 * Drop a noncanonical OOC pair from canon history.
 * Parent OOC user is always dropped.
 * Assistant is dropped unless the user later adopted that scene.
 */
export function filterCanonicalMessageRows<T extends CanonicalMessageRow>(rows: T[]): T[] {
  const byId = new Map<number, T>();
  for (const row of rows) {
    const id = rowId(row);
    if (id != null) byId.set(id, row);
  }

  const dropUserIds = new Set<number>();
  const dropAssistantIds = new Set<number>();

  const markParentUserDrop = (row: T) => {
    if (row.role === "user") {
      const id = rowId(row);
      if (id != null) dropUserIds.add(id);
    }
    if (row.role === "assistant") {
      const parentId = linkedUserId(row);
      if (parentId != null) dropUserIds.add(parentId);
    }
  };

  const markAssistantDrop = (row: T) => {
    if (row.role !== "assistant" || isCanonAdoptedScene(row.usage)) return;
    const id = rowId(row);
    if (id != null) dropAssistantIds.add(id);
    markParentUserDrop(row);
  };

  for (const row of rows) {
    if (isOriginOocUserRow(row) || isNoncanonicalGeneration(row.usage)) {
      markParentUserDrop(row);
      markAssistantDrop(row);
    }
  }

  for (const row of rows) {
    if (row.role !== "assistant") continue;
    if (isCanonAdoptedScene(row.usage)) continue;
    const parentId = linkedUserId(row);
    const parent = parentId != null ? byId.get(parentId) : undefined;
    if (
      parent &&
      (dropUserIds.has(parentId!) ||
        isOriginOocUserRow(parent) ||
        isNoncanonicalGeneration(parent.usage))
    ) {
      markAssistantDrop(row);
    }
  }

  return rows.filter((row) => {
    const id = rowId(row);
    if (row.role === "user" && id != null && dropUserIds.has(id)) return false;
    if (row.role === "assistant") {
      if (isCanonAdoptedScene(row.usage)) return true;
      if (id != null && dropAssistantIds.has(id)) return false;
      const parentId = linkedUserId(row);
      if (parentId != null && dropUserIds.has(parentId)) return false;
    }
    return true;
  });
}

export function buildOocSceneRenderUserPrompt(userMessage: string): string {
  return `[NONCANONICAL OOC SCENE]
이번 출력은 본편의 다음 사건이 아닌 독립적인 가정/샘플 장면이다.
캐릭터·세계관·관계 설정은 참고하되, 현재 본편의 물리적 연속성을 실제 사건처럼 이어가거나 변경하지 않는다.
요청된 장면만 출력한다.

[User message]
${userMessage.trim()}`;
}

function parseUsageObject(usage: unknown): Record<string, unknown> | null {
  if (!usage) return null;
  if (typeof usage === "string") {
    const trimmed = usage.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof usage === "object" ? (usage as Record<string, unknown>) : null;
}

/** Finalize/partial overwrite must not drop generationKind/canonical. */
export function mergeIncomingUsageWithStoredSemantics(
  storedUsage: unknown,
  incomingUsageJson: string
): string {
  const incoming = parseUsageObject(incomingUsageJson);
  if (!incoming) return incomingUsageJson;
  const semantics =
    readGenerationSemantics(incoming) ?? readGenerationSemantics(storedUsage);
  if (!semantics || !isOocSceneRenderSemantics(semantics)) return incomingUsageJson;
  return JSON.stringify(mergeGenerationSemantics(incoming, semantics));
}

export function persistGenerationSemanticsOnMessages(
  db: Database.Database,
  opts: {
    userMessageId?: number | null;
    assistantMessageId?: number | null;
    semantics: GenerationSemantics;
  }
): void {
  if (!isOocSceneRenderSemantics(opts.semantics)) return;
  const ids = [opts.userMessageId, opts.assistantMessageId].filter(
    (id): id is number => id != null && Number.isSafeInteger(id) && id > 0
  );
  for (const id of ids) {
    const row = db.prepare("SELECT usage FROM messages WHERE id=?").get(id) as
      | { usage?: unknown }
      | undefined;
    const existing = parseUsageObject(row?.usage) ?? {};
    const merged = mergeGenerationSemantics(existing, opts.semantics);
    db.prepare("UPDATE messages SET usage=? WHERE id=?").run(JSON.stringify(merged), id);
  }
}

export function adoptOocSceneRenderUsage(
  storedUsage: unknown,
  adoptedAt: string
): Record<string, unknown> {
  const existing = parseUsageObject(storedUsage) ?? {};
  const current = readCanonAdoptionFromRecord(existing);
  return {
    ...existing,
    generationKind: OOC_SCENE_RENDER_GENERATION_KIND,
    canonical: false,
    canonAdopted: true,
    canonAdoptedAt: current.canonAdopted ? (current.canonAdoptedAt ?? adoptedAt) : adoptedAt,
  };
}

export type AdoptOocSceneRenderResult =
  | {
      ok: true;
      alreadyAdopted: boolean;
      canonAdoptedAt: string;
      assistantMessageId: number;
    }
  | { ok: false; status: number; code: string; error: string };

export function isOocSceneAdoptionEligibleRow(row: {
  role?: string | null;
  model?: string | null;
  content?: string | null;
  generation_status?: string | null;
  usage?: unknown;
}): { ok: true } | { ok: false; code: string; error: string } {
  if (row.role !== "assistant") {
    return { ok: false, code: "not_assistant", error: "AI 장면만 본편에 반영할 수 있습니다." };
  }
  if (row.model === "greeting") {
    return { ok: false, code: "greeting", error: "인사말은 본편에 반영할 수 없습니다." };
  }
  if (!isOocSceneRenderSemantics(readGenerationSemantics(row.usage))) {
    return {
      ok: false,
      code: "not_ooc_scene_render",
      error: "비정사 OOC 장면만 본편에 반영할 수 있습니다.",
    };
  }
  const status = (row.generation_status ?? "completed").toLowerCase();
  if (!FINALIZED_SUCCESS_STATUSES.has(status)) {
    return {
      ok: false,
      code: "not_finalized",
      error: "완료된 장면만 본편에 반영할 수 있습니다.",
    };
  }
  if (!String(row.content ?? "").trim()) {
    return { ok: false, code: "empty_output", error: "빈 출력은 본편에 반영할 수 없습니다." };
  }
  return { ok: true };
}

function writeActiveVariantAdoption(
  alternatesJson: string | null | undefined,
  activeVariant: number | null | undefined,
  nextUsage: Record<string, unknown>
): string | null {
  if (!alternatesJson || alternatesJson === "[]") return alternatesJson ?? "[]";
  try {
    const variants = JSON.parse(alternatesJson) as Array<{ usage?: unknown }>;
    if (!Array.isArray(variants) || variants.length === 0) return alternatesJson;
    let idx = activeVariant ?? variants.length - 1;
    if (idx < 0) idx = 0;
    if (idx >= variants.length) idx = variants.length - 1;
    variants[idx] = { ...variants[idx], usage: nextUsage };
    return JSON.stringify(variants);
  } catch {
    return alternatesJson;
  }
}

export function adoptOocSceneRenderCore(
  db: Database.Database,
  opts: {
    chatId: number;
    assistantMessageId: number;
    ownerUserId: number;
    now?: string;
  }
): AdoptOocSceneRenderResult {
  const chatId = Number(opts.chatId);
  const assistantMessageId = Number(opts.assistantMessageId);
  const ownerUserId = Number(opts.ownerUserId);
  if (
    !Number.isSafeInteger(chatId) ||
    chatId <= 0 ||
    !Number.isSafeInteger(assistantMessageId) ||
    assistantMessageId <= 0 ||
    !Number.isSafeInteger(ownerUserId) ||
    ownerUserId <= 0
  ) {
    return { ok: false, status: 400, code: "invalid_request", error: "요청이 올바르지 않습니다." };
  }

  const run = db.transaction((): AdoptOocSceneRenderResult => {
    const chat = db
      .prepare("SELECT id FROM chats WHERE id=? AND user_id=?")
      .get(chatId, ownerUserId) as { id: number } | undefined;
    if (!chat) {
      return { ok: false, status: 404, code: "not_found", error: "채팅방을 찾을 수 없습니다." };
    }

    const row = db
      .prepare(
        `SELECT id, chat_id, role, content, model, usage, generation_status, alternates, active_variant
         FROM messages WHERE id=? AND chat_id=?`
      )
      .get(assistantMessageId, chatId) as
      | {
          id: number;
          chat_id: number;
          role: string;
          content: string;
          model: string;
          usage: unknown;
          generation_status: string | null;
          alternates: string | null;
          active_variant: number | null;
        }
      | undefined;
    if (!row) {
      return { ok: false, status: 404, code: "not_found", error: "메시지를 찾을 수 없습니다." };
    }

    const eligible = isOocSceneAdoptionEligibleRow(row);
    if (!eligible.ok) {
      return { ok: false, status: 400, code: eligible.code, error: eligible.error };
    }

    const existing = readCanonAdoption(row.usage);
    if (existing.canonAdopted) {
      return {
        ok: true,
        alreadyAdopted: true,
        canonAdoptedAt: existing.canonAdoptedAt ?? "",
        assistantMessageId: row.id,
      };
    }

    const adoptedAt = opts.now ?? new Date().toISOString();
    const nextUsage = adoptOocSceneRenderUsage(row.usage, adoptedAt);
    const nextAlternates = writeActiveVariantAdoption(
      row.alternates,
      row.active_variant,
      nextUsage
    );
    db.prepare(
      "UPDATE messages SET usage=?, alternates=?, updated_at=datetime('now') WHERE id=? AND chat_id=?"
    ).run(JSON.stringify(nextUsage), nextAlternates, row.id, chatId);

    return {
      ok: true,
      alreadyAdopted: false,
      canonAdoptedAt: adoptedAt,
      assistantMessageId: row.id,
    };
  });

  return run.immediate();
}
