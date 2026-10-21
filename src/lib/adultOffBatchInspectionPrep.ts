import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { parseAdultOffAuxApproval } from "@/lib/adultOffAuxApproval";
import {
  asyncRecordMatchesGenerationScope,
  resolveActiveAssistantGenerationScope,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";
import {
  ADULT_OFF_GUARD_POLICY_VERSION,
  adultOffApprovalProofForTexts,
  adultOffApprovedTextHash,
  adultOffStoredTextDisposition,
  applyAdultOffStoredInspection,
  collectStatusMetaVisibleTexts,
  collectStatusWidgetVisibleTexts,
  collectSuggestedReplyVisibleTexts,
  listAdultOffInspectionTargets,
  type AdultOffGuardDecision,
  type AdultOffInspectionOutcome,
  type AdultOffInspectionTarget,
} from "@/lib/adultOffOutputGuard";
import {
  generationSequenceForVariant,
  normalizeMessageVariants,
  type MessageVariant,
} from "@/lib/messageAlternates";
import {
  ensureProviderCostLedgerSchema,
  isLedgerEventCostExact,
} from "@/lib/providerCostLedger";
import { isInFlightGenerationStatus } from "@/lib/streamingPersistenceShared";
import { parseStatusMetaRecord } from "@/lib/statusMeta/types";
import { statusMetaHasDisplayContent } from "@/lib/statusMeta/render";
import { parseStoredStatusWidgetValuesJson } from "@/lib/statusWidget/parseValues";
import { parseSuggestedRepliesRecord } from "@/lib/suggestedReplies/parse";

export type AdultOffInspectionMessageRow = {
  id: number;
  role: string;
  content: string;
  model?: string | null;
  usage?: string | null;
  alternates?: string | null;
  active_variant?: number | null;
  status_meta?: string | null;
  suggested_replies_json?: string | null;
  status_widget_values_json?: string | null;
};

export type AdultOffTargetFingerprint = {
  messageId: number;
  variantIndex: number;
  textSha256: string;
  activeVariant: number;
};

export type AdultOffInspectionPlanKind =
  | "reuse_approved"
  | "reuse_restricted"
  | "needs_classification"
  | "skip_empty";

export type AdultOffInspectionPlanItem = {
  target: AdultOffInspectionTarget;
  fingerprint: AdultOffTargetFingerprint;
  kind: AdultOffInspectionPlanKind;
  variantUsage: Record<string, unknown> | null;
};

export type AdultOffBatchCommitResult =
  | "written"
  | "written_variant_isolated"
  | "skipped_stale"
  | "skipped_noop"
  | "skipped_unresolved";

/** 표시 위젯이 어디서 왔는지 — 활성 variant 스냅샷인지, row 레벨 legacy fallback인지. */
export type AdultOffWidgetSource = "variant_snapshot" | "row_fallback";

export type AdultOffAuxTextItem = {
  messageId: number;
  variantIndex: number | null;
  surface: AdultOffAuxTextSurface;
  widgetSource?: AdultOffWidgetSource;
  texts: string[];
  hasV2ApprovalProof: boolean;
  allTextsApprovedByProof: boolean;
};

export type AdultOffAuxTextSurface =
  | "status_meta"
  | "suggested_replies"
  | "status_widget"
  | "status_widget_inactive";

export type AdultOffAuxSurfaceSurvey = {
  displayStatusMetaMessages: number;
  suggestedReplyMessages: number;
  displayWidgetMessages: number;
  variantWidgetTextCount: number;
  inactiveVariantWidgetMessages: number;
  inactiveVariantWidgetTextCount: number;
  auxTextItems: number;
  auxItemsMissingV2Proof: number;
  auxItemsWithUnapprovedVisibleText: number;
  auxUnreviewedVisibleTextCount: number;
  items: AdultOffAuxTextItem[];
};

export type AdultOffBodyInspectionSurvey = {
  targets: number;
  needsClassification: number;
  reuseApproved: number;
  reuseRestricted: number;
  skipEmpty: number;
  activeRowMirrorInconsistentMessages: number;
  structuralUsageMetadataMessages: number;
  contentMismatchMessages: number;
  modelMismatchMessages: number;
  settlementMismatchMessages: number;
  bodyUnreviewedTargets: number;
};

export type AdultOffActiveRowMirrorSummary = {
  inconsistentMessageIds: number[];
  contentMismatchMessageIds: number[];
  modelMismatchMessageIds: number[];
  settlementMismatchMessageIds: number[];
  structuralUsageMetadataMessages: number;
};

/**
 * `messages.usage`에 없고 활성 variant usage에만 있는 내부 메타.
 * 생성 경로는 public receipt sanitizer로 row usage에서 `adultRouting`을 빼고,
 * variant usage와 `adult_route_meta_json`에만 남긴다.
 */
const VARIANT_ONLY_USAGE_METADATA_KEYS = ["adultRouting"] as const;

/**
 * 활성 variant usage에 없고 row usage에만 있는 정산 메타.
 * `persistAssistantMessageFinalCharge`는 row usage에 항상 기록하고,
 * request id가 활성 generation과 일치할 때만 variant usage에도 기록한다.
 */
const ROW_ONLY_USAGE_METADATA_KEYS = ["billingContractDispatch"] as const;

export type AdultOffUsageMirrorAssessment = {
  contentMatches: boolean;
  modelMatches: boolean;
  settlementMatches: boolean;
  mirrors: boolean;
  structuralMetadataOnly: boolean;
  variantOnlyKeys: string[];
  rowOnlyKeys: string[];
  conflictingKeys: string[];
};

export type AdultOffBatchReadOnlySurvey = {
  body: AdultOffBodyInspectionSurvey;
  aux: Omit<AdultOffAuxSurfaceSurvey, "items">;
  mirrorInconsistentMessageIds: number[];
  contentMismatchMessageIds: number[];
  modelMismatchMessageIds: number[];
  settlementMismatchMessageIds: number[];
};

export type AdultOffBatchRehearsalStats = {
  targetCount: number;
  uniqueTextCount: number;
  reuseApproved: number;
  reuseRestricted: number;
  classified: number;
  written: number;
  writtenVariantIsolated: number;
  skippedStale: number;
  skippedNoop: number;
  skippedUnresolved: number;
};

const ASSISTANT_INSPECTION_COLUMNS = `messages.id, messages.role, messages.content, messages.model, messages.usage,
  messages.alternates, messages.active_variant, messages.status_meta, messages.suggested_replies_json,
  messages.status_widget_values_json`;

function assistantInspectionSql(chatId?: number): { sql: string; params: number[] } {
  const clauses = [`messages.role = 'assistant'`];
  const params: number[] = [];
  if (chatId != null) {
    clauses.push("messages.chat_id = ?");
    params.push(chatId);
  }
  return {
    sql: `SELECT ${ASSISTANT_INSPECTION_COLUMNS} FROM messages WHERE ${clauses.join(" AND ")} ORDER BY messages.id ASC`,
    params,
  };
}

function rowForVariantNormalization(row: AdultOffInspectionMessageRow) {
  return {
    content: row.content,
    model: row.model ?? "",
    usage: row.usage ?? null,
    alternates: row.alternates ?? null,
    active_variant: row.active_variant ?? null,
  };
}

function parseUsageJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function variantUsageObject(variant: MessageVariant | undefined): Record<string, unknown> | null {
  if (!variant?.usage) return null;
  return variant.usage as Record<string, unknown>;
}

export function adultOffInspectionTextSha256(text: string): string {
  return adultOffApprovedTextHash(text);
}

export function fingerprintAdultOffInspectionTarget(
  row: AdultOffInspectionMessageRow,
  variantIndex: number,
  text: string
): AdultOffTargetFingerprint {
  const { activeVariant } = normalizeMessageVariants(rowForVariantNormalization(row));
  return {
    messageId: row.id,
    variantIndex,
    textSha256: adultOffInspectionTextSha256(text),
    activeVariant,
  };
}

export function planAdultOffInspectionItem(
  row: AdultOffInspectionMessageRow,
  target: AdultOffInspectionTarget
): AdultOffInspectionPlanItem {
  const { variants } = normalizeMessageVariants(rowForVariantNormalization(row));
  const variant = variants[target.variantIndex];
  const usage = variantUsageObject(variant);
  const fingerprint = fingerprintAdultOffInspectionTarget(row, target.variantIndex, target.text);
  if (!target.text.trim()) {
    return { target, fingerprint, kind: "skip_empty", variantUsage: usage };
  }
  const disposition = adultOffStoredTextDisposition(usage, target.text);
  if (disposition === "approved") {
    return { target, fingerprint, kind: "reuse_approved", variantUsage: usage };
  }
  if (disposition === "restricted") {
    return { target, fingerprint, kind: "reuse_restricted", variantUsage: usage };
  }
  return { target, fingerprint, kind: "needs_classification", variantUsage: usage };
}

/** assistant logical variant 목록과 v2 해시 재사용 계획. */
export function planAdultOffBatchInspection(
  rows: readonly AdultOffInspectionMessageRow[]
): AdultOffInspectionPlanItem[] {
  const targets = listAdultOffInspectionTargets(rows);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return targets.map((target) => {
    const row = byId.get(target.messageId);
    if (!row) {
      throw new Error(`missing message row ${target.messageId}`);
    }
    return planAdultOffInspectionItem(row, target);
  });
}

/** 유료 분류 1회로 묶을 고유 본문(정확한 문자열) 목록. */
export function dedupeAdultOffClassificationTexts(
  plan: readonly AdultOffInspectionPlanItem[]
): string[] {
  const seen = new Set<string>();
  const texts: string[] = [];
  for (const item of plan) {
    if (item.kind !== "needs_classification") continue;
    const text = item.target.text;
    if (seen.has(text)) continue;
    seen.add(text);
    texts.push(text);
  }
  return texts;
}

export function planAdultOffBatchInspectionSummary(plan: readonly AdultOffInspectionPlanItem[]) {
  return {
    targets: plan.length,
    reuseApproved: plan.filter((item) => item.kind === "reuse_approved").length,
    reuseRestricted: plan.filter((item) => item.kind === "reuse_restricted").length,
    needsClassification: plan.filter((item) => item.kind === "needs_classification").length,
    uniqueClassificationTexts: dedupeAdultOffClassificationTexts(plan).length,
    skipEmpty: plan.filter((item) => item.kind === "skip_empty").length,
  };
}

function sortJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortJsonValue);
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortJsonValue(record[key]);
  }
  return sorted;
}

/** JSON 키 순서와 무관하게 usage 객체 의미를 비교한다. */
export function usageRecordsSemanticallyEqual(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null
): boolean {
  return JSON.stringify(sortJsonValue(left ?? null)) === JSON.stringify(sortJsonValue(right ?? null));
}

function usageWithoutAdultOffGuard(usage: Record<string, unknown> | null): Record<string, unknown> {
  if (!usage) return {};
  const { adultOffGuard: _omit, ...rest } = usage;
  return rest;
}

function usageValueEqual(left: unknown, right: unknown): boolean {
  return usageRecordsSemanticallyEqual(
    { value: left as Record<string, unknown> | null },
    { value: right as Record<string, unknown> | null }
  );
}

/** 활성 variant와 row의 본문·모델·정산 usage. 위치 고정 메타만 구조적 차이로 둔다. */
export function assessActiveVariantCanonicalMirror(
  row: AdultOffInspectionMessageRow,
  variants: MessageVariant[],
  activeVariant: number
): AdultOffUsageMirrorAssessment {
  const active = variants[activeVariant];
  const contentMatches = Boolean(active) && row.content === active.content;
  const modelMatches = Boolean(active) && (row.model ?? "") === (active.model ?? "");
  const rowUsage = usageWithoutAdultOffGuard(parseUsageJson(row.usage));
  const variantUsage = usageWithoutAdultOffGuard(variantUsageObject(active));
  const variantOnlyKeys: string[] = [];
  const rowOnlyKeys: string[] = [];
  const conflictingKeys: string[] = [];
  const keys = new Set([...Object.keys(rowUsage), ...Object.keys(variantUsage)]);
  for (const key of [...keys].sort()) {
    const inRow = Object.prototype.hasOwnProperty.call(rowUsage, key);
    const inVariant = Object.prototype.hasOwnProperty.call(variantUsage, key);
    if (inRow && inVariant) {
      if (!usageValueEqual(rowUsage[key], variantUsage[key])) conflictingKeys.push(key);
      continue;
    }
    if (
      inVariant &&
      !inRow &&
      (VARIANT_ONLY_USAGE_METADATA_KEYS as readonly string[]).includes(key)
    ) {
      variantOnlyKeys.push(key);
      continue;
    }
    if (inRow && !inVariant && (ROW_ONLY_USAGE_METADATA_KEYS as readonly string[]).includes(key)) {
      rowOnlyKeys.push(key);
      continue;
    }
    conflictingKeys.push(key);
  }
  const settlementMatches = Boolean(active) && conflictingKeys.length === 0;
  const mirrors = contentMatches && modelMatches && settlementMatches;
  return {
    contentMatches,
    modelMatches,
    settlementMatches,
    mirrors,
    structuralMetadataOnly:
      mirrors && (variantOnlyKeys.length > 0 || rowOnlyKeys.length > 0),
    variantOnlyKeys,
    rowOnlyKeys,
    conflictingKeys,
  };
}

/** `listAdultOffInspectionTargets()`와 동일 — 비어 있지 않은 inspectable variant가 있는지. */
export function assistantRowHasAdultOffInspectableContent(
  row: AdultOffInspectionMessageRow
): boolean {
  return listAdultOffInspectionTargets([row]).length > 0;
}

/**
 * canonical 본문은 있는데 inspectable variant가 없음 — 정상 빈 행이 아니라 조사 대상.
 */
export function assistantRowHasCanonicalContentWithoutInspectableVariant(
  row: AdultOffInspectionMessageRow
): boolean {
  if (!row.content.trim()) return false;
  return !assistantRowHasAdultOffInspectableContent(row);
}

/** 활성 variant와 row canonical 미러. 구조적 usage 메타 차이는 미러로 본다. */
export function activeVariantMirrorsCanonicalRow(
  row: AdultOffInspectionMessageRow,
  variants: MessageVariant[],
  activeVariant: number
): boolean {
  return assessActiveVariantCanonicalMirror(row, variants, activeVariant).mirrors;
}

export function summarizeActiveRowMirror(
  rows: readonly AdultOffInspectionMessageRow[]
): AdultOffActiveRowMirrorSummary {
  const inconsistentMessageIds: number[] = [];
  const contentMismatchMessageIds: number[] = [];
  const modelMismatchMessageIds: number[] = [];
  const settlementMismatchMessageIds: number[] = [];
  let structuralUsageMetadataMessages = 0;
  for (const row of rows) {
    if (row.role !== "assistant") continue;
    if (assistantRowHasCanonicalContentWithoutInspectableVariant(row)) {
      inconsistentMessageIds.push(row.id);
      contentMismatchMessageIds.push(row.id);
      continue;
    }
    if (!assistantRowHasAdultOffInspectableContent(row)) continue;
    const { variants, activeVariant } = normalizeMessageVariants(rowForVariantNormalization(row));
    const assessment = assessActiveVariantCanonicalMirror(row, variants, activeVariant);
    if (assessment.structuralMetadataOnly) structuralUsageMetadataMessages += 1;
    if (assessment.mirrors) continue;
    inconsistentMessageIds.push(row.id);
    if (!assessment.contentMatches) contentMismatchMessageIds.push(row.id);
    if (!assessment.modelMatches) modelMismatchMessageIds.push(row.id);
    if (!assessment.settlementMatches) settlementMismatchMessageIds.push(row.id);
  }
  return {
    inconsistentMessageIds,
    contentMismatchMessageIds,
    modelMismatchMessageIds,
    settlementMismatchMessageIds,
    structuralUsageMetadataMessages,
  };
}

export function listActiveRowMirrorInconsistentMessageIds(
  rows: readonly AdultOffInspectionMessageRow[]
): number[] {
  return summarizeActiveRowMirror(rows).inconsistentMessageIds;
}

function fingerprintMatchesRow(
  row: AdultOffInspectionMessageRow,
  fingerprint: AdultOffTargetFingerprint,
  expectedText: string
): boolean {
  const { variants, activeVariant } = normalizeMessageVariants(rowForVariantNormalization(row));
  if (activeVariant !== fingerprint.activeVariant) return false;
  const variant = variants[fingerprint.variantIndex];
  const text = variant?.content ?? "";
  if (adultOffInspectionTextSha256(text) !== fingerprint.textSha256) return false;
  if (text !== expectedText) return false;
  return true;
}

function hadPersistedAlternates(row: AdultOffInspectionMessageRow): boolean {
  const raw = row.alternates?.trim();
  return Boolean(raw && raw !== "[]");
}

function assertAdultOffProofDoesNotChangeUsage(
  prior: Record<string, unknown> | null,
  next: Record<string, unknown>
): void {
  if (
    JSON.stringify(usageWithoutAdultOffGuard(prior)) !==
    JSON.stringify(usageWithoutAdultOffGuard(next))
  ) {
    throw new Error("adult-off batch write would change settlement fields");
  }
}

type AdultOffVariantProofEntry = { text: string; outcome: AdultOffInspectionOutcome };

/**
 * 한 variant usage와, 본문이 같은 활성 row usage에 정책 해시만 더하는 단일 writer.
 * 본문 commit과 위젯 commit이 같은 규칙을 쓴다. row usage를 variant usage로 바꾸지 않고,
 * 본문·모델이 어긋나면 variant에만 기록한다. 정산 usage가 어긋나면 stale.
 * 호출자가 이미 transaction 안에서 row를 읽고 fingerprint를 검증했어야 한다.
 */
function writeAdultOffVariantProofs(
  db: DatabaseType,
  row: AdultOffInspectionMessageRow,
  variantIndex: number,
  entries: readonly AdultOffVariantProofEntry[]
): AdultOffBatchCommitResult {
  const { variants, activeVariant } = normalizeMessageVariants(rowForVariantNormalization(row));
  const variant = variants[variantIndex];
  if (!variant) return "skipped_stale";

  const mirror = assessActiveVariantCanonicalMirror(row, variants, activeVariant);
  const targetIsActive = variantIndex === activeVariant;
  if (targetIsActive && !mirror.settlementMatches) return "skipped_stale";

  const stampRowUsage = targetIsActive && mirror.contentMatches && mirror.modelMatches;
  const priorVariantUsage = variantUsageObject(variant);
  const priorRowUsage = parseUsageJson(row.usage);
  let nextVariantUsage: Record<string, unknown> | null = priorVariantUsage;
  let nextRowUsage: Record<string, unknown> | null = priorRowUsage;
  let variantWrote = false;
  let rowWrote = false;
  for (const entry of entries) {
    const variantApplied = applyAdultOffStoredInspection(
      nextVariantUsage,
      entry.text,
      entry.outcome
    );
    nextVariantUsage = variantApplied.usage;
    variantWrote ||= variantApplied.wrote;
    if (stampRowUsage) {
      const rowApplied = applyAdultOffStoredInspection(nextRowUsage, entry.text, entry.outcome);
      nextRowUsage = rowApplied.usage;
      rowWrote ||= rowApplied.wrote;
    }
  }

  if (!variantWrote && !rowWrote) return "skipped_noop";
  assertAdultOffProofDoesNotChangeUsage(priorVariantUsage, nextVariantUsage ?? {});
  if (stampRowUsage) assertAdultOffProofDoesNotChangeUsage(priorRowUsage, nextRowUsage ?? {});

  const nextVariants = variants.slice();
  nextVariants[variantIndex] = {
    ...variant,
    usage: (nextVariantUsage ?? {}) as MessageVariant["usage"],
  };

  if (!hadPersistedAlternates(row)) {
    if (!stampRowUsage) return "skipped_stale";
    db.prepare(`UPDATE messages SET usage=? WHERE id=?`).run(JSON.stringify(nextRowUsage), row.id);
    return "written";
  }

  if (stampRowUsage) {
    db.prepare(`UPDATE messages SET usage=?, alternates=? WHERE id=?`).run(
      JSON.stringify(nextRowUsage),
      JSON.stringify(nextVariants),
      row.id
    );
    return "written";
  }

  db.prepare(`UPDATE messages SET alternates=? WHERE id=?`).run(
    JSON.stringify(nextVariants),
    row.id
  );
  return targetIsActive ? "written_variant_isolated" : "written";
}

/**
 * variant usage와, 본문이 같은 활성 row usage에 정책 해시만 더한다.
 * 정산 usage가 어긋나거나 fingerprint가 바뀌면 stale로 건너뛴다.
 */
export function commitAdultOffInspectionIfFresh(
  db: DatabaseType,
  input: {
    fingerprint: AdultOffTargetFingerprint;
    expectedText: string;
    outcome: AdultOffInspectionOutcome;
  }
): AdultOffBatchCommitResult {
  if (!input.expectedText.trim() || input.outcome === "unresolved") {
    return "skipped_unresolved";
  }

  const select = db.prepare(
    `SELECT id, role, content, model, usage, alternates, active_variant FROM messages WHERE id=?`
  );

  return db.transaction(() => {
    const row = select.get(input.fingerprint.messageId) as AdultOffInspectionMessageRow | undefined;
    if (!row || row.role !== "assistant") return "skipped_stale";
    if (!fingerprintMatchesRow(row, input.fingerprint, input.expectedText)) {
      return "skipped_stale";
    }
    return writeAdultOffVariantProofs(db, row, input.fingerprint.variantIndex, [
      { text: input.expectedText, outcome: input.outcome },
    ]);
  })();
}

function usageApprovesAllTexts(usage: unknown, texts: readonly string[]): boolean {
  if (texts.length === 0) return true;
  return texts.every((text) => adultOffStoredTextDisposition(usage, text) === "approved");
}

function auxProofApprovesTexts(proof: unknown, texts: readonly string[]): boolean {
  const parsed = parseAdultOffAuxApproval(proof);
  if (!parsed || parsed.policyVersion !== ADULT_OFF_GUARD_POLICY_VERSION) return false;
  return usageApprovesAllTexts({ adultOffGuard: parsed }, texts);
}

function auxDisplayApproved(
  activeUsage: unknown,
  recordProof: unknown,
  texts: readonly string[]
): boolean {
  const proofs =
    recordProof == null ? [activeUsage] : [activeUsage, { adultOffGuard: recordProof }];
  return texts.every((text) =>
    proofs.some((proof) => adultOffStoredTextDisposition(proof, text) === "approved")
  );
}

function auxHasV2ApprovalProof(
  activeUsage: unknown,
  recordProof: unknown,
  texts: readonly string[]
): boolean {
  if (texts.length === 0) return true;
  const parsed = parseAdultOffAuxApproval(recordProof);
  if (parsed?.policyVersion === ADULT_OFF_GUARD_POLICY_VERSION && auxProofApprovesTexts(parsed, texts)) {
    return true;
  }
  return usageApprovesAllTexts(activeUsage, texts);
}

/**
 * `mapDbMessageForClient` / messages GET와 동일한 위젯 선택.
 * 활성 variant에 `statusWidgetValues` 키가 있으면(null 포함) row fallback 없음.
 */
export function resolveDisplayedStatusWidgetTexts(
  row: AdultOffInspectionMessageRow,
  variants: MessageVariant[],
  activeVariant: number
): {
  texts: string[];
  proofUsage: unknown;
  source: AdultOffWidgetSource | "none";
} {
  const active = variants[activeVariant];
  const hasVariantStatusSnapshot =
    active != null && Object.prototype.hasOwnProperty.call(active, "statusWidgetValues");
  if (hasVariantStatusSnapshot) {
    const texts = collectStatusWidgetVisibleTexts(active.statusWidgetValues ?? null);
    return {
      texts,
      proofUsage: active.usage ?? null,
      source: texts.length > 0 ? "variant_snapshot" : "none",
    };
  }
  const fromRow = collectStatusWidgetVisibleTexts(
    parseStoredStatusWidgetValuesJson(row.status_widget_values_json)
  );
  if (fromRow.length > 0) {
    return { texts: fromRow, proofUsage: rowActiveUsage(row), source: "row_fallback" };
  }
  return { texts: [], proofUsage: active?.usage ?? null, source: "none" };
}

function rowActiveUsage(row: AdultOffInspectionMessageRow): Record<string, unknown> | null {
  const { variants, activeVariant } = normalizeMessageVariants(rowForVariantNormalization(row));
  return variantUsageObject(variants[activeVariant]);
}

/** 운영 DB 읽기 전용 집계 — 새 유료 호출 없음. */
export function surveyAdultOffAuxSurfaces(
  rows: readonly AdultOffInspectionMessageRow[]
): AdultOffAuxSurfaceSurvey {
  let displayStatusMetaMessages = 0;
  let suggestedReplyMessages = 0;
  let displayWidgetMessages = 0;
  let variantWidgetTextCount = 0;
  let inactiveVariantWidgetMessages = 0;
  let inactiveVariantWidgetTextCount = 0;
  let auxUnreviewedVisibleTextCount = 0;
  const items: AdultOffAuxTextItem[] = [];

  for (const row of rows) {
    if (row.role !== "assistant") continue;
    const activeUsage = rowActiveUsage(row);

    const metaRecord = parseStatusMetaRecord(row.status_meta ?? null);
    if (metaRecord?.meta && statusMetaHasDisplayContent(metaRecord.meta)) {
      displayStatusMetaMessages += 1;
      const texts = collectStatusMetaVisibleTexts(metaRecord.meta);
      const recordProof = metaRecord.adultOffGuard;
      const allTextsApprovedByProof = auxDisplayApproved(activeUsage, recordProof, texts);
      if (!allTextsApprovedByProof) {
        auxUnreviewedVisibleTextCount += texts.length;
      }
      items.push({
        messageId: row.id,
        variantIndex: null,
        surface: "status_meta",
        texts,
        hasV2ApprovalProof: auxHasV2ApprovalProof(activeUsage, recordProof, texts),
        allTextsApprovedByProof,
      });
    }

    const repliesRecord = parseSuggestedRepliesRecord(row.suggested_replies_json ?? null);
    const replyTexts = collectSuggestedReplyVisibleTexts(repliesRecord?.replies ?? null);
    if (replyTexts.length > 0) {
      suggestedReplyMessages += 1;
      const recordProof = repliesRecord?.adultOffGuard;
      const allTextsApprovedByProof = auxDisplayApproved(activeUsage, recordProof, replyTexts);
      if (!allTextsApprovedByProof) {
        auxUnreviewedVisibleTextCount += replyTexts.length;
      }
      items.push({
        messageId: row.id,
        variantIndex: null,
        surface: "suggested_replies",
        texts: replyTexts,
        hasV2ApprovalProof: auxHasV2ApprovalProof(activeUsage, recordProof, replyTexts),
        allTextsApprovedByProof,
      });
    }

    const { variants, activeVariant } = normalizeMessageVariants(rowForVariantNormalization(row));
    const displayed = resolveDisplayedStatusWidgetTexts(row, variants, activeVariant);
    if (displayed.texts.length > 0) {
      displayWidgetMessages += 1;
      variantWidgetTextCount += displayed.texts.length;
      const allTextsApprovedByProof = usageApprovesAllTexts(displayed.proofUsage, displayed.texts);
      if (!allTextsApprovedByProof) {
        auxUnreviewedVisibleTextCount += displayed.texts.length;
      }
      items.push({
        messageId: row.id,
        variantIndex: activeVariant,
        surface: "status_widget",
        widgetSource: displayed.source === "row_fallback" ? "row_fallback" : "variant_snapshot",
        texts: displayed.texts,
        hasV2ApprovalProof: usageApprovesAllTexts(displayed.proofUsage, displayed.texts),
        allTextsApprovedByProof,
      });
    }

    variants.forEach((variant, index) => {
      if (index === activeVariant) return;
      const texts = collectStatusWidgetVisibleTexts(variant.statusWidgetValues);
      if (texts.length === 0) return;
      inactiveVariantWidgetMessages += 1;
      inactiveVariantWidgetTextCount += texts.length;
      const allTextsApprovedByProof = usageApprovesAllTexts(variant.usage, texts);
      if (!allTextsApprovedByProof) {
        auxUnreviewedVisibleTextCount += texts.length;
      }
      items.push({
        messageId: row.id,
        variantIndex: index,
        surface: "status_widget_inactive",
        widgetSource: "variant_snapshot",
        texts,
        hasV2ApprovalProof: usageApprovesAllTexts(variant.usage, texts),
        allTextsApprovedByProof,
      });
    });
  }

  return {
    displayStatusMetaMessages,
    suggestedReplyMessages,
    displayWidgetMessages,
    variantWidgetTextCount,
    inactiveVariantWidgetMessages,
    inactiveVariantWidgetTextCount,
    auxTextItems: items.length,
    auxItemsMissingV2Proof: items.filter((item) => !item.hasV2ApprovalProof).length,
    auxItemsWithUnapprovedVisibleText: items.filter((item) => !item.allTextsApprovedByProof).length,
    auxUnreviewedVisibleTextCount,
    items,
  };
}

export function surveyAdultOffBatchReadOnly(
  rows: readonly AdultOffInspectionMessageRow[]
): AdultOffBatchReadOnlySurvey {
  const plan = planAdultOffBatchInspection(rows);
  const summary = planAdultOffBatchInspectionSummary(plan);
  const mirror = summarizeActiveRowMirror(rows);
  const aux = surveyAdultOffAuxSurfaces(rows);
  const { items: _items, ...auxCounts } = aux;
  return {
    body: {
      targets: summary.targets,
      needsClassification: summary.needsClassification,
      reuseApproved: summary.reuseApproved,
      reuseRestricted: summary.reuseRestricted,
      skipEmpty: summary.skipEmpty,
      activeRowMirrorInconsistentMessages: mirror.inconsistentMessageIds.length,
      structuralUsageMetadataMessages: mirror.structuralUsageMetadataMessages,
      contentMismatchMessages: mirror.contentMismatchMessageIds.length,
      modelMismatchMessages: mirror.modelMismatchMessageIds.length,
      settlementMismatchMessages: mirror.settlementMismatchMessageIds.length,
      bodyUnreviewedTargets: summary.needsClassification,
    },
    aux: auxCounts,
    mirrorInconsistentMessageIds: mirror.inconsistentMessageIds,
    contentMismatchMessageIds: mirror.contentMismatchMessageIds,
    modelMismatchMessageIds: mirror.modelMismatchMessageIds,
    settlementMismatchMessageIds: mirror.settlementMismatchMessageIds,
  };
}

export function loadAssistantRowsForAdultOffInspection(
  db: DatabaseType,
  options?: { chatId?: number }
): AdultOffInspectionMessageRow[] {
  const { sql, params } = assistantInspectionSql(options?.chatId);
  return db.prepare(sql).all(...params) as AdultOffInspectionMessageRow[];
}

/** 격리 DB에서 합성 분류기로 일괄 리허설. 유료 API 호출 없음. */
export function runAdultOffBatchInspectionRehearsal(
  db: DatabaseType,
  classify: (text: string) => AdultOffInspectionOutcome,
  options?: { writeReuse?: boolean; chatId?: number }
): AdultOffBatchRehearsalStats {
  const writeReuse = options?.writeReuse ?? false;
  const rows = loadAssistantRowsForAdultOffInspection(db, { chatId: options?.chatId });
  const plan = planAdultOffBatchInspection(rows);
  const summary = planAdultOffBatchInspectionSummary(plan);
  const classificationByText = new Map<string, AdultOffInspectionOutcome>();
  for (const text of dedupeAdultOffClassificationTexts(plan)) {
    classificationByText.set(text, classify(text));
  }

  const stats: AdultOffBatchRehearsalStats = {
    targetCount: plan.length,
    uniqueTextCount: summary.uniqueClassificationTexts,
    reuseApproved: summary.reuseApproved,
    reuseRestricted: summary.reuseRestricted,
    classified: 0,
    written: 0,
    writtenVariantIsolated: 0,
    skippedStale: 0,
    skippedNoop: 0,
    skippedUnresolved: 0,
  };

  for (const item of plan) {
    let outcome: AdultOffInspectionOutcome | null = null;
    switch (item.kind) {
      case "reuse_approved":
        if (!writeReuse) continue;
        outcome = "approved";
        break;
      case "reuse_restricted":
        if (!writeReuse) continue;
        outcome = "restricted";
        break;
      case "needs_classification": {
        outcome = classificationByText.get(item.target.text) ?? "unresolved";
        stats.classified += 1;
        break;
      }
      default:
        continue;
    }
    if (!outcome) continue;
    const result = commitAdultOffInspectionIfFresh(db, {
      fingerprint: item.fingerprint,
      expectedText: item.target.text,
      outcome,
    });
    switch (result) {
      case "written":
        stats.written += 1;
        break;
      case "written_variant_isolated":
        stats.writtenVariantIsolated += 1;
        break;
      case "skipped_stale":
        stats.skippedStale += 1;
        break;
      case "skipped_noop":
        stats.skippedNoop += 1;
        break;
      case "skipped_unresolved":
        stats.skippedUnresolved += 1;
        break;
      default: {
        const never: never = result;
        throw new Error(String(never));
      }
    }
  }

  return stats;
}

export const ADULT_OFF_BATCH_MODERATION_REQUEST_KIND = "adult-off-output-moderation";

export type AdultOffAuxCommitResult =
  | "written"
  | "skipped_stale"
  | "skipped_noop"
  | "skipped_unresolved";

export type AdultOffAuxSurfaceFingerprint = {
  messageId: number;
  surface: AdultOffAuxTextSurface;
  variantIndex: number | null;
  textsSha256: string;
  generationSequence: number;
  generationRequestId: string | null;
  /** 위젯: 조사 시점의 활성 variant. 이후 활성/비활성이 바뀌면 stale. */
  activeVariant: number | null;
  widgetSource: AdultOffWidgetSource | null;
  /** variant 스냅샷 해시 또는 row fallback 원문 JSON 해시. */
  widgetSnapshotSha256: string | null;
  variantGenerationSequence: number | null;
};

export function fingerprintAdultOffAuxTexts(texts: readonly string[]): string {
  return sha256Hex(texts.join("\u0000"));
}

export function widgetSnapshotSha256(values: unknown): string {
  return sha256Hex(JSON.stringify(values ?? null));
}

export function adultOffGuardDecisionToInspectionOutcome(
  decision: AdultOffGuardDecision
): AdultOffInspectionOutcome {
  switch (decision.status) {
    case "approved":
      return "approved";
    case "blocked":
      return "restricted";
    case "check_failed":
      return "unresolved";
    default: {
      const never: never = decision;
      throw new Error(String(never));
    }
  }
}

function auxOutcomesAllowProof(outcomes: readonly AdultOffInspectionOutcome[]): boolean {
  return outcomes.length > 0 && outcomes.every((outcome) => outcome === "approved");
}

function activeScopeForMessageId(
  db: DatabaseType,
  messageId: number
): AssistantGenerationScope | null {
  return resolveActiveAssistantGenerationScope(messageId, db);
}

function scopeMatchesFingerprint(
  scope: AssistantGenerationScope | null,
  fingerprint: AdultOffAuxSurfaceFingerprint
): boolean {
  if (!scope) return false;
  if (scope.generationSequence !== fingerprint.generationSequence) return false;
  if (
    fingerprint.generationRequestId &&
    scope.generationRequestId &&
    fingerprint.generationRequestId !== scope.generationRequestId
  ) {
    return false;
  }
  return true;
}

function sameTexts(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((text, index) => text === right[index]);
}

type AuxJsonSurface = "status_meta" | "suggested_replies";

type AuxJsonRecordView = {
  pending: boolean;
  failed: boolean;
  generationSequence: number | null | undefined;
  generationRequestId: string | null | undefined;
  visibleTexts: string[];
  guard: unknown;
};

function readAuxJsonRecord(surface: AuxJsonSurface, raw: string | null): AuxJsonRecordView | null {
  if (surface === "status_meta") {
    const record = parseStatusMetaRecord(raw);
    if (!record) return null;
    return {
      pending: record.pending === true,
      failed: record.failed === true,
      generationSequence: record.generationSequence,
      generationRequestId: record.generationRequestId,
      visibleTexts: collectStatusMetaVisibleTexts(record.meta),
      guard: record.adultOffGuard,
    };
  }
  const record = parseSuggestedRepliesRecord(raw);
  if (!record) return null;
  return {
    pending: record.pending === true,
    failed: record.failed === true,
    generationSequence: record.generationSequence,
    generationRequestId: record.generationRequestId,
    visibleTexts: collectSuggestedReplyVisibleTexts(record.replies),
    guard: record.adultOffGuard,
  };
}

function auxJsonColumn(surface: AuxJsonSurface): "status_meta" | "suggested_replies_json" {
  return surface === "status_meta" ? "status_meta" : "suggested_replies_json";
}

function readRawAuxColumn(
  db: DatabaseType,
  messageId: number,
  surface: AuxJsonSurface
): { generation_status: string | null; raw: string | null } | undefined {
  return db
    .prepare(
      `SELECT generation_status, ${auxJsonColumn(surface)} AS raw FROM messages
       WHERE id=? AND role='assistant'`
    )
    .get(messageId) as { generation_status: string | null; raw: string | null } | undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 원문 JSON에서 `adultOffGuard`만 갱신한다. 알 수 없는 필드·구조는 그대로 둔다.
 * 다른 정책 버전의 해시 목록은 현재 정책 증명으로 승격하지 않고 버린다.
 */
function withAdultOffAuxProof(
  rawRecord: Record<string, unknown>,
  proof: { policyVersion: number; approvedTextHashes: string[] }
): Record<string, unknown> {
  const existing = isPlainRecord(rawRecord.adultOffGuard) ? rawRecord.adultOffGuard : {};
  const samePolicy = existing.policyVersion === ADULT_OFF_GUARD_POLICY_VERSION;
  const {
    approvedTextHashes: priorApproved,
    restrictedTextHashes: priorRestricted,
    ...extraGuardFields
  } = existing;
  const approvedBefore = samePolicy && Array.isArray(priorApproved)
    ? priorApproved.filter((item): item is string => typeof item === "string")
    : [];
  const approved = [...new Set([...approvedBefore, ...proof.approvedTextHashes])];
  const nextGuard: Record<string, unknown> = {
    ...extraGuardFields,
    policyVersion: proof.policyVersion,
    approvedTextHashes: approved,
  };
  if (samePolicy && Array.isArray(priorRestricted)) {
    nextGuard.restrictedTextHashes = priorRestricted.filter(
      (item) => typeof item !== "string" || !approved.includes(item)
    );
  }
  return { ...rawRecord, adultOffGuard: nextGuard };
}

type WidgetSurfaceState = {
  source: AdultOffWidgetSource;
  texts: string[];
  snapshotSha256: string;
  proofUsage: unknown;
};

function resolveWidgetSurfaceState(
  row: AdultOffInspectionMessageRow,
  variants: MessageVariant[],
  activeVariant: number,
  variantIndex: number
): WidgetSurfaceState | null {
  const variant = variants[variantIndex];
  if (!variant) return null;
  if (variantIndex === activeVariant) {
    const displayed = resolveDisplayedStatusWidgetTexts(row, variants, activeVariant);
    if (displayed.source === "none") return null;
    return {
      source: displayed.source,
      texts: displayed.texts,
      snapshotSha256:
        displayed.source === "row_fallback"
          ? sha256Hex(row.status_widget_values_json ?? "")
          : widgetSnapshotSha256(variant.statusWidgetValues),
      proofUsage: displayed.proofUsage,
    };
  }
  const texts = collectStatusWidgetVisibleTexts(variant.statusWidgetValues);
  if (texts.length === 0) return null;
  return {
    source: "variant_snapshot",
    texts,
    snapshotSha256: widgetSnapshotSha256(variant.statusWidgetValues),
    proofUsage: variant.usage ?? null,
  };
}

const AUX_ROW_COLUMNS = `id, role, content, model, usage, alternates, active_variant,
  status_widget_values_json, generation_status`;

type AuxRowWithStatus = AdultOffInspectionMessageRow & { generation_status?: string | null };

/** 배치 backfill용 — `surveyAdultOffAuxSurfaces` 항목의 stale 검증 fingerprint. 유료 호출 전에 만든다. */
export function fingerprintAdultOffAuxSurveyItem(
  row: AdultOffInspectionMessageRow,
  item: AdultOffAuxTextItem,
  db: DatabaseType
): AdultOffAuxSurfaceFingerprint | null {
  const texts = item.texts.filter((text) => text.trim());
  if (texts.length === 0) return null;
  const generationStatus = db
    .prepare("SELECT generation_status FROM messages WHERE id=?")
    .get(row.id) as { generation_status: string | null } | undefined;
  if (!generationStatus || isInFlightGenerationStatus(generationStatus.generation_status)) {
    return null;
  }
  const scope = activeScopeForMessageId(db, row.id);

  switch (item.surface) {
    case "status_meta":
    case "suggested_replies": {
      const view = readAuxJsonRecord(
        item.surface,
        item.surface === "status_meta" ? (row.status_meta ?? null) : (row.suggested_replies_json ?? null)
      );
      if (!view || view.pending || view.failed) return null;
      if (!sameTexts(view.visibleTexts, texts)) return null;
      return {
        messageId: row.id,
        surface: item.surface,
        variantIndex: null,
        textsSha256: fingerprintAdultOffAuxTexts(texts),
        generationSequence: view.generationSequence ?? scope?.generationSequence ?? 0,
        generationRequestId: view.generationRequestId ?? scope?.generationRequestId ?? null,
        activeVariant: null,
        widgetSource: null,
        widgetSnapshotSha256: null,
        variantGenerationSequence: null,
      };
    }
    case "status_widget":
    case "status_widget_inactive": {
      if (item.variantIndex == null || !scope) return null;
      const { variants, activeVariant } = normalizeMessageVariants(rowForVariantNormalization(row));
      if ((item.variantIndex === activeVariant) !== (item.surface === "status_widget")) return null;
      const state = resolveWidgetSurfaceState(row, variants, activeVariant, item.variantIndex);
      if (!state || !sameTexts(state.texts, texts)) return null;
      if (item.widgetSource && item.widgetSource !== state.source) return null;
      return {
        messageId: row.id,
        surface: item.surface,
        variantIndex: item.variantIndex,
        textsSha256: fingerprintAdultOffAuxTexts(texts),
        generationSequence: scope.generationSequence,
        generationRequestId: scope.generationRequestId,
        activeVariant,
        widgetSource: state.source,
        widgetSnapshotSha256: state.snapshotSha256,
        variantGenerationSequence: generationSequenceForVariant(
          variants[item.variantIndex],
          item.variantIndex
        ),
      };
    }
    default: {
      const never: never = item.surface;
      throw new Error(String(never));
    }
  }
}

/** 배치 한 번의 분류 호출 하나를 가리키는 원장 generation_request_id. */
export function buildAdultOffBatchGenerationRequestId(
  runId: string,
  callKey: number | string
): string {
  return `${adultOffBatchRunRequestPrefix(runId)}${callKey}`;
}

export function adultOffBatchRunRequestPrefix(runId: string): string {
  return `adult-off-batch/${runId}/`;
}

export type AdultOffBatchModerationSpend = {
  settledUsd: number;
  unknownCostEvents: number;
  totalEvents: number;
};

type BatchLedgerRow = {
  actual_cost_usd: number | null;
  actual_cost_source: string | null;
  event_status: string | null;
};

function summarizeBatchLedgerRows(rows: readonly BatchLedgerRow[]): AdultOffBatchModerationSpend {
  let settledUsd = 0;
  let unknownCostEvents = 0;
  for (const row of rows) {
    if (isLedgerEventCostExact(row)) {
      settledUsd += row.actual_cost_usd ?? 0;
    } else {
      unknownCostEvents += 1;
    }
  }
  return { settledUsd, unknownCostEvents, totalEvents: rows.length };
}

/** 한 분류 호출(generation_request_id 정확 일치)의 원장 비용. 행이 없으면 totalEvents=0. */
export function readAdultOffBatchCallCost(
  db: DatabaseType,
  generationRequestId: string
): AdultOffBatchModerationSpend {
  ensureProviderCostLedgerSchema(db);
  const rows = db
    .prepare(
      `SELECT actual_cost_usd, actual_cost_source, event_status FROM api_cost_ledger
       WHERE request_kind = ? AND generation_request_id = ?`
    )
    .all(ADULT_OFF_BATCH_MODERATION_REQUEST_KIND, generationRequestId) as BatchLedgerRow[];
  return summarizeBatchLedgerRows(rows);
}

/** 한 RUN_ID 아래 모든 분류 호출의 원장 비용. prefix는 LIKE가 아니라 정확한 문자열 접두사로 맞춘다. */
export function sumAdultOffBatchModerationSpend(
  db: DatabaseType,
  runId: string
): AdultOffBatchModerationSpend {
  ensureProviderCostLedgerSchema(db);
  const rows = db
    .prepare(
      `SELECT actual_cost_usd, actual_cost_source, event_status FROM api_cost_ledger
       WHERE request_kind = ? AND instr(generation_request_id, ?) = 1`
    )
    .all(ADULT_OFF_BATCH_MODERATION_REQUEST_KIND, adultOffBatchRunRequestPrefix(runId)) as BatchLedgerRow[];
  return summarizeBatchLedgerRows(rows);
}

function commitAdultOffAuxJsonRecordIfFresh(
  db: DatabaseType,
  surface: AuxJsonSurface,
  input: {
    fingerprint: AdultOffAuxSurfaceFingerprint;
    expectedTexts: readonly string[];
    outcomes: readonly AdultOffInspectionOutcome[];
  }
): AdultOffAuxCommitResult {
  if (input.fingerprint.surface !== surface) return "skipped_stale";
  if (!auxOutcomesAllowProof(input.outcomes)) return "skipped_unresolved";
  if (input.expectedTexts.length !== input.outcomes.length) return "skipped_stale";
  if (fingerprintAdultOffAuxTexts(input.expectedTexts) !== input.fingerprint.textsSha256) {
    return "skipped_stale";
  }

  return db.transaction((): AdultOffAuxCommitResult => {
    const stored = readRawAuxColumn(db, input.fingerprint.messageId, surface);
    if (!stored || !stored.raw) return "skipped_stale";
    if (isInFlightGenerationStatus(stored.generation_status)) return "skipped_stale";
    const view = readAuxJsonRecord(surface, stored.raw);
    if (!view || view.pending || view.failed) return "skipped_stale";
    if (!sameTexts(view.visibleTexts, input.expectedTexts)) return "skipped_stale";
    const scope = activeScopeForMessageId(db, input.fingerprint.messageId);
    if (!scopeMatchesFingerprint(scope, input.fingerprint)) return "skipped_stale";
    if (!asyncRecordMatchesGenerationScope(view, scope!)) return "skipped_stale";
    if (auxProofApprovesTexts(view.guard, input.expectedTexts)) return "skipped_noop";
    const proof = adultOffApprovalProofForTexts(input.expectedTexts);
    if (!proof) return "skipped_unresolved";

    let rawRecord: unknown;
    try {
      rawRecord = JSON.parse(stored.raw);
    } catch {
      return "skipped_stale";
    }
    if (!isPlainRecord(rawRecord)) return "skipped_stale";
    db.prepare(`UPDATE messages SET ${auxJsonColumn(surface)}=? WHERE id=?`).run(
      JSON.stringify(withAdultOffAuxProof(rawRecord, proof)),
      input.fingerprint.messageId
    );
    return "written";
  })();
}

export function commitAdultOffAuxStatusMetaIfFresh(
  db: DatabaseType,
  input: {
    fingerprint: AdultOffAuxSurfaceFingerprint;
    expectedTexts: readonly string[];
    outcomes: readonly AdultOffInspectionOutcome[];
  }
): AdultOffAuxCommitResult {
  return commitAdultOffAuxJsonRecordIfFresh(db, "status_meta", input);
}

export function commitAdultOffAuxSuggestedRepliesIfFresh(
  db: DatabaseType,
  input: {
    fingerprint: AdultOffAuxSurfaceFingerprint;
    expectedTexts: readonly string[];
    outcomes: readonly AdultOffInspectionOutcome[];
  }
): AdultOffAuxCommitResult {
  return commitAdultOffAuxJsonRecordIfFresh(db, "suggested_replies", input);
}

/**
 * 위젯 문자열 승인 증명을 variant usage(필요하면 활성 row usage)에 쓴다.
 * 본문 commit과 같은 `writeAdultOffVariantProofs`를 쓰며, legacy row fallback 위젯은
 * 활성 variant가 증명 대상이다. 위젯 값 자체와 alternates의 다른 variant는 건드리지 않는다.
 */
export function commitAdultOffAuxWidgetIfFresh(
  db: DatabaseType,
  input: {
    fingerprint: AdultOffAuxSurfaceFingerprint;
    expectedTexts: readonly string[];
    outcomes: readonly AdultOffInspectionOutcome[];
  }
): AdultOffAuxCommitResult {
  const { fingerprint } = input;
  if (fingerprint.surface !== "status_widget" && fingerprint.surface !== "status_widget_inactive") {
    return "skipped_stale";
  }
  if (!auxOutcomesAllowProof(input.outcomes)) return "skipped_unresolved";
  if (
    fingerprint.variantIndex == null ||
    fingerprint.activeVariant == null ||
    fingerprint.widgetSource == null ||
    fingerprint.widgetSnapshotSha256 == null ||
    fingerprint.variantGenerationSequence == null
  ) {
    return "skipped_stale";
  }
  if (input.expectedTexts.length !== input.outcomes.length) return "skipped_stale";
  if (fingerprintAdultOffAuxTexts(input.expectedTexts) !== fingerprint.textsSha256) {
    return "skipped_stale";
  }
  const variantIndex = fingerprint.variantIndex;

  return db.transaction((): AdultOffAuxCommitResult => {
    const row = db
      .prepare(`SELECT ${AUX_ROW_COLUMNS} FROM messages WHERE id=?`)
      .get(fingerprint.messageId) as AuxRowWithStatus | undefined;
    if (!row || row.role !== "assistant") return "skipped_stale";
    if (isInFlightGenerationStatus(row.generation_status)) return "skipped_stale";
    const scope = activeScopeForMessageId(db, row.id);
    if (!scopeMatchesFingerprint(scope, fingerprint)) return "skipped_stale";

    const { variants, activeVariant } = normalizeMessageVariants(rowForVariantNormalization(row));
    if (activeVariant !== fingerprint.activeVariant) return "skipped_stale";
    if ((variantIndex === activeVariant) !== (fingerprint.surface === "status_widget")) {
      return "skipped_stale";
    }
    const state = resolveWidgetSurfaceState(row, variants, activeVariant, variantIndex);
    if (!state) return "skipped_stale";
    if (state.source !== fingerprint.widgetSource) return "skipped_stale";
    if (state.snapshotSha256 !== fingerprint.widgetSnapshotSha256) return "skipped_stale";
    if (!sameTexts(state.texts, input.expectedTexts)) return "skipped_stale";
    if (
      generationSequenceForVariant(variants[variantIndex], variantIndex) !==
      fingerprint.variantGenerationSequence
    ) {
      return "skipped_stale";
    }
    if (usageApprovesAllTexts(state.proofUsage, input.expectedTexts)) return "skipped_noop";

    const result = writeAdultOffVariantProofs(
      db,
      row,
      variantIndex,
      input.expectedTexts.map((text) => ({ text, outcome: "approved" as const }))
    );
    switch (result) {
      case "written":
      case "written_variant_isolated":
        return "written";
      case "skipped_stale":
      case "skipped_noop":
      case "skipped_unresolved":
        return result;
      default: {
        const never: never = result;
        throw new Error(String(never));
      }
    }
  })();
}

export function commitAdultOffAuxSurveyItemIfFresh(
  db: DatabaseType,
  input: {
    fingerprint: AdultOffAuxSurfaceFingerprint;
    expectedTexts: readonly string[];
    outcomes: readonly AdultOffInspectionOutcome[];
  }
): AdultOffAuxCommitResult {
  switch (input.fingerprint.surface) {
    case "status_meta":
      return commitAdultOffAuxStatusMetaIfFresh(db, input);
    case "suggested_replies":
      return commitAdultOffAuxSuggestedRepliesIfFresh(db, input);
    case "status_widget":
    case "status_widget_inactive":
      return commitAdultOffAuxWidgetIfFresh(db, input);
    default: {
      const never: never = input.fingerprint.surface;
      throw new Error(String(never));
    }
  }
}

/**
 * SQLite `VACUUM INTO`로 일관 스냅샷 복사. 원본은 readonly만 사용하며
 * checkpoint/WAL truncate/원본 데이터 변경 없음 (better-sqlite3 backup 미지원 환경 대응).
 */
export function copySqliteDatabaseForRehearsal(sourcePath: string, destPath: string): void {
  const sourceResolved = path.resolve(sourcePath);
  const destResolved = path.resolve(destPath);
  if (sourceResolved === destResolved) {
    throw new Error("copySqliteDatabaseForRehearsal: source and destination must differ");
  }
  if (fs.existsSync(destResolved)) {
    throw new Error("copySqliteDatabaseForRehearsal: destination already exists");
  }
  fs.mkdirSync(path.dirname(destResolved), { recursive: true });

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    const escapedDest = destResolved.replace(/'/g, "''");
    source.exec(`VACUUM INTO '${escapedDest}'`);
  } finally {
    source.close();
  }
}

export function sqliteIntegrityCheck(db: DatabaseType): string {
  const row = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string };
  return row.integrity_check ?? "unknown";
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
