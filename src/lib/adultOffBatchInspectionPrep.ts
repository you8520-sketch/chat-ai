import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { parseAdultOffAuxApproval } from "@/lib/adultOffAuxApproval";
import {
  ADULT_OFF_GUARD_POLICY_VERSION,
  adultOffApprovedTextHash,
  adultOffStoredTextDisposition,
  applyAdultOffStoredInspection,
  collectStatusMetaVisibleTexts,
  collectStatusWidgetVisibleTexts,
  collectSuggestedReplyVisibleTexts,
  listAdultOffInspectionTargets,
  type AdultOffInspectionOutcome,
  type AdultOffInspectionTarget,
} from "@/lib/adultOffOutputGuard";
import { normalizeMessageVariants, variantToRowFields, type MessageVariant } from "@/lib/messageAlternates";
import { parseStatusMetaRecord } from "@/lib/statusMeta/types";
import { statusMetaHasDisplayContent } from "@/lib/statusMeta/render";
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
  | "skipped_stale"
  | "skipped_noop"
  | "skipped_unresolved";

export type AdultOffAuxTextItem = {
  messageId: number;
  variantIndex: number | null;
  surface: "status_meta" | "suggested_replies" | "status_widget";
  texts: string[];
  hasV2ApprovalProof: boolean;
  allTextsApprovedByProof: boolean;
};

export type AdultOffAuxSurfaceSurvey = {
  displayStatusMetaMessages: number;
  suggestedReplyMessages: number;
  variantWidgetTextCount: number;
  auxTextItems: number;
  auxItemsMissingV2Proof: number;
  auxItemsWithUnapprovedVisibleText: number;
  items: AdultOffAuxTextItem[];
};

export type AdultOffBatchRehearsalStats = {
  targetCount: number;
  uniqueTextCount: number;
  reuseApproved: number;
  reuseRestricted: number;
  classified: number;
  written: number;
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

function usageWithoutAdultOffGuard(usage: Record<string, unknown> | null): Record<string, unknown> {
  if (!usage) return {};
  const { adultOffGuard: _omit, ...rest } = usage;
  return rest;
}

/**
 * variant usage에 해시를 기록하고, 활성 variant면 row content/model/usage 미러를 맞춘다.
 * fingerprint가 어긋나면 stale로 건너뛴다(재생성·variant 전환 경합).
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

    const { variants, activeVariant } = normalizeMessageVariants(rowForVariantNormalization(row));
    const variant = variants[input.fingerprint.variantIndex];
    if (!variant) return "skipped_stale";

    const priorUsage = variantUsageObject(variant);
    const applied = applyAdultOffStoredInspection(priorUsage, input.expectedText, input.outcome);
    if (!applied.wrote) return "skipped_noop";

    if (
      JSON.stringify(usageWithoutAdultOffGuard(priorUsage)) !==
      JSON.stringify(usageWithoutAdultOffGuard(applied.usage))
    ) {
      throw new Error("adult-off batch write would change settlement fields");
    }

    const nextVariants = variants.slice();
    nextVariants[input.fingerprint.variantIndex] = {
      ...variant,
      usage: applied.usage as MessageVariant["usage"],
    };

    const alternatesJson =
      nextVariants.length > 1 || row.alternates?.trim()
        ? JSON.stringify(nextVariants)
        : null;

    if (input.fingerprint.variantIndex === activeVariant) {
      const fields = variantToRowFields(nextVariants, activeVariant);
      db.prepare(
        `UPDATE messages SET content=?, model=?, usage=?, alternates=?, active_variant=? WHERE id=?`
      ).run(
        fields.content,
        fields.model,
        fields.usage,
        alternatesJson,
        activeVariant,
        input.fingerprint.messageId
      );
    } else {
      db.prepare(`UPDATE messages SET alternates=? WHERE id=?`).run(
        alternatesJson,
        input.fingerprint.messageId
      );
    }
    return "written";
  })();
}

function auxProofApprovesTexts(proof: unknown, texts: readonly string[]): boolean {
  const parsed = parseAdultOffAuxApproval(proof);
  if (!parsed || parsed.policyVersion !== ADULT_OFF_GUARD_POLICY_VERSION) return false;
  const carrier = { adultOffGuard: parsed };
  return texts.every((text) => adultOffStoredTextDisposition(carrier, text) === "approved");
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
  let variantWidgetTextCount = 0;
  const items: AdultOffAuxTextItem[] = [];

  for (const row of rows) {
    if (row.role !== "assistant") continue;
    const activeUsage = rowActiveUsage(row);

    const metaRecord = parseStatusMetaRecord(row.status_meta ?? null);
    if (metaRecord?.meta && statusMetaHasDisplayContent(metaRecord.meta)) {
      displayStatusMetaMessages += 1;
      const texts = collectStatusMetaVisibleTexts(metaRecord.meta);
      const proof = metaRecord.adultOffGuard;
      items.push({
        messageId: row.id,
        variantIndex: null,
        surface: "status_meta",
        texts,
        hasV2ApprovalProof: Boolean(
          proof && proof.policyVersion === ADULT_OFF_GUARD_POLICY_VERSION
        ),
        allTextsApprovedByProof: auxProofApprovesTexts(proof, texts),
      });
    }

    const repliesRecord = parseSuggestedRepliesRecord(row.suggested_replies_json ?? null);
    const replyTexts = collectSuggestedReplyVisibleTexts(repliesRecord?.replies ?? null);
    if (replyTexts.length > 0) {
      suggestedReplyMessages += 1;
      const proof = repliesRecord?.adultOffGuard;
      items.push({
        messageId: row.id,
        variantIndex: null,
        surface: "suggested_replies",
        texts: replyTexts,
        hasV2ApprovalProof: Boolean(
          proof && proof.policyVersion === ADULT_OFF_GUARD_POLICY_VERSION
        ),
        allTextsApprovedByProof: auxProofApprovesTexts(proof, replyTexts),
      });
    }

    const { variants, activeVariant } = normalizeMessageVariants(rowForVariantNormalization(row));
    variants.forEach((variant, index) => {
      const widgetTexts = collectStatusWidgetVisibleTexts(variant.statusWidgetValues);
      if (widgetTexts.length === 0) return;
      variantWidgetTextCount += widgetTexts.length;
      items.push({
        messageId: row.id,
        variantIndex: index,
        surface: "status_widget",
        texts: widgetTexts,
        hasV2ApprovalProof: false,
        allTextsApprovedByProof: widgetTexts.every(
          (text) => adultOffStoredTextDisposition(variant.usage, text) === "approved"
        ),
      });
    });

    const variantHasWidget = variants.some(
      (variant) => collectStatusWidgetVisibleTexts(variant.statusWidgetValues).length > 0
    );
    if (!variantHasWidget && row.status_widget_values_json?.trim()) {
      try {
        const parsed = JSON.parse(row.status_widget_values_json) as unknown;
        const legacyTexts = collectStatusWidgetVisibleTexts(
          parsed as Parameters<typeof collectStatusWidgetVisibleTexts>[0]
        );
        if (legacyTexts.length > 0) {
          variantWidgetTextCount += legacyTexts.length;
          items.push({
            messageId: row.id,
            variantIndex: activeVariant,
            surface: "status_widget",
            texts: legacyTexts,
            hasV2ApprovalProof: false,
            allTextsApprovedByProof: legacyTexts.every(
              (text) => adultOffStoredTextDisposition(activeUsage, text) === "approved"
            ),
          });
        }
      } catch {
        // malformed legacy json — skip
      }
    }
  }

  return {
    displayStatusMetaMessages,
    suggestedReplyMessages,
    variantWidgetTextCount,
    auxTextItems: items.length,
    auxItemsMissingV2Proof: items.filter((item) => !item.hasV2ApprovalProof).length,
    auxItemsWithUnapprovedVisibleText: items.filter((item) => !item.allTextsApprovedByProof).length,
    items,
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

/** SQLite 파일 일관 복사(WAL 포함). 운영 읽기 전용 소스 → 격리 리허설용. */
export function copySqliteDatabaseForRehearsal(sourcePath: string, destPath: string): void {
  const source = new Database(sourcePath, { fileMustExist: true });
  try {
    source.pragma("wal_checkpoint(TRUNCATE)");
    const escapedDest = destPath.replace(/'/g, "''");
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
