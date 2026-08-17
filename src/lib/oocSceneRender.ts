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
};

export const CANONICAL_GENERATION_SEMANTICS: GenerationSemantics = {
  generationKind: CANONICAL_GENERATION_KIND,
  canonical: true,
};

export const OOC_SCENE_RENDER_SEMANTICS: GenerationSemantics = {
  generationKind: OOC_SCENE_RENDER_GENERATION_KIND,
  canonical: false,
};

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

export function readGenerationSemantics(usage: unknown): GenerationSemantics | null {
  if (!usage) return null;
  let parsed: unknown = usage;
  if (typeof usage === "string") {
    const trimmed = usage.trim();
    if (!trimmed) return null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { generationKind?: unknown; canonical?: unknown };
  if (record.generationKind === OOC_SCENE_RENDER_GENERATION_KIND) {
    return OOC_SCENE_RENDER_SEMANTICS;
  }
  if (record.generationKind === CANONICAL_GENERATION_KIND || record.canonical === true) {
    return CANONICAL_GENERATION_SEMANTICS;
  }
  if (record.canonical === false) return OOC_SCENE_RENDER_SEMANTICS;
  return null;
}

export function isNoncanonicalGeneration(usage: unknown): boolean {
  return isOocSceneRenderSemantics(readGenerationSemantics(usage));
}

export function isCanonicalGeneration(usage: unknown): boolean {
  const semantics = readGenerationSemantics(usage);
  if (!semantics) return true;
  return semantics.canonical === true;
}

export function mergeGenerationSemantics<T extends object>(
  usage: T,
  semantics: GenerationSemantics
): T & GenerationSemantics {
  return {
    ...usage,
    generationKind: semantics.generationKind,
    canonical: semantics.canonical,
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

/**
 * Drop a noncanonical assistant together with its parent user (pair).
 * Also drops an orphan user that already carries noncanonical usage/intent.
 */
export function filterCanonicalMessageRows<T extends CanonicalMessageRow>(rows: T[]): T[] {
  const byId = new Map<number, T>();
  for (const row of rows) {
    const id = rowId(row);
    if (id != null) byId.set(id, row);
  }

  const dropUserIds = new Set<number>();
  const dropAssistantIds = new Set<number>();

  const markNoncanonical = (row: T) => {
    const id = rowId(row);
    if (row.role === "user" && id != null) dropUserIds.add(id);
    if (row.role === "assistant") {
      if (id != null) dropAssistantIds.add(id);
      const parentId = linkedUserId(row);
      if (parentId != null) dropUserIds.add(parentId);
    }
  };

  for (const row of rows) {
    if (isNoncanonicalGeneration(row.usage)) {
      markNoncanonical(row);
      continue;
    }
    if (row.role === "user" && resolveOocSceneRenderIntent(row.content ?? "")) {
      markNoncanonical(row);
    }
  }

  for (const row of rows) {
    if (row.role !== "assistant") continue;
    const parentId = linkedUserId(row);
    const parent = parentId != null ? byId.get(parentId) : undefined;
    if (
      parent &&
      (dropUserIds.has(parentId!) ||
        isNoncanonicalGeneration(parent.usage) ||
        resolveOocSceneRenderIntent(parent.content ?? ""))
    ) {
      markNoncanonical(row);
    }
  }

  return rows.filter((row) => {
    const id = rowId(row);
    if (row.role === "user" && id != null && dropUserIds.has(id)) return false;
    if (row.role === "assistant") {
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
