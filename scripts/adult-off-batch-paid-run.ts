/**
 * Adult OFF batch moderation — PLAN_ONLY by default; paid execution requires explicit approval.
 *
 *   node --conditions=react-server --import tsx scripts/adult-off-batch-paid-run.ts
 *
 * Env:
 *   ADULT_OFF_BATCH_MODE=plan|execute     (default plan)
 *   ADULT_OFF_BATCH_APPROVE_PAID=1        required for execute + provider calls
 *   ADULT_OFF_BATCH_CAP_KRW=1500          proposed ceiling (not auto-approved)
 *   ADULT_OFF_BATCH_RUN_ID=...            stable id for ledger prefix + resume
 *   ADULT_OFF_BATCH_ALLOW_PROD_WRITE=1    required when DATA_DIR points at live /data
 *   DATA_DIR                              sqlite directory (isolated copy recommended first)
 */
import Module from "node:module";
import fs from "node:fs";
import path from "node:path";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import Database from "better-sqlite3";
import { getDatabasePath, getRemoteDatabaseConfig } from "@/lib/dataDir";
import {
  ADULT_OFF_BATCH_MODERATION_REQUEST_KIND,
  adultOffGuardDecisionToInspectionOutcome,
  buildAdultOffBatchGenerationRequestId,
  commitAdultOffAuxSurveyItemIfFresh,
  commitAdultOffInspectionIfFresh,
  dedupeAdultOffClassificationTexts,
  fingerprintAdultOffAuxSurveyItem,
  fingerprintAdultOffInspectionTarget,
  loadAssistantRowsForAdultOffInspection,
  planAdultOffBatchInspection,
  planAdultOffBatchInspectionSummary,
  sumAdultOffBatchModerationSpend,
  surveyAdultOffAuxSurfaces,
  type AdultOffInspectionMessageRow,
  type AdultOffInspectionOutcome,
} from "@/lib/adultOffBatchInspectionPrep";
import {
  ADULT_OFF_GUARD_WINDOW_CHARS,
  ADULT_OFF_GUARD_WINDOW_OVERLAP_CHARS,
  adultOffStoredTextDisposition,
  evaluateAdultOffOutput,
  splitAdultOffGuardWindows,
} from "@/lib/adultOffOutputGuard";
import { createAdultOffClassifier } from "@/lib/adultOffOutputClassifier";

const MODE = (process.env.ADULT_OFF_BATCH_MODE?.trim() || "plan").toLowerCase();
const APPROVE_PAID = process.env.ADULT_OFF_BATCH_APPROVE_PAID === "1";
const CAP_KRW = Number(process.env.ADULT_OFF_BATCH_CAP_KRW ?? "1500");
const RUN_ID =
  process.env.ADULT_OFF_BATCH_RUN_ID?.trim() ||
  `manual-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const ALLOW_PROD_WRITE = process.env.ADULT_OFF_BATCH_ALLOW_PROD_WRITE === "1";
const CONSERVATIVE_KRW_PER_WINDOW = Number(process.env.ADULT_OFF_BATCH_KRW_PER_WINDOW ?? "0.45");
const PROBE_MEAN_KRW = Number(process.env.ADULT_OFF_BATCH_PROBE_MEAN_KRW ?? "0.179");

type TextOutcomeCache = Map<string, AdultOffInspectionOutcome>;

function isLiveProdDb(dbPath: string): boolean {
  return path.resolve(dbPath) === path.resolve("/data/app.db");
}

function collectAllProofUsages(row: AdultOffInspectionMessageRow): unknown[] {
  const proofs: unknown[] = [];
  if (row.usage) {
    try {
      proofs.push(JSON.parse(row.usage));
    } catch {
      /* ignore */
    }
  }
  if (row.alternates?.trim() && row.alternates !== "[]") {
    try {
      const variants = JSON.parse(row.alternates) as Array<{ usage?: unknown }>;
      for (const variant of variants) {
        if (variant.usage) proofs.push(variant.usage);
      }
    } catch {
      /* ignore */
    }
  }
  const meta = row.status_meta;
  if (meta?.trim()) {
    try {
      const parsed = JSON.parse(meta) as { adultOffGuard?: unknown };
      if (parsed.adultOffGuard) proofs.push({ adultOffGuard: parsed.adultOffGuard });
    } catch {
      /* ignore */
    }
  }
  const replies = row.suggested_replies_json;
  if (replies?.trim()) {
    try {
      const parsed = JSON.parse(replies) as { adultOffGuard?: unknown };
      if (parsed.adultOffGuard) proofs.push({ adultOffGuard: parsed.adultOffGuard });
    } catch {
      /* ignore */
    }
  }
  return proofs;
}

function storedDispositionForText(
  rows: readonly AdultOffInspectionMessageRow[],
  text: string
): AdultOffInspectionOutcome | null {
  for (const row of rows) {
    for (const proof of collectAllProofUsages(row)) {
      const disposition = adultOffStoredTextDisposition(proof, text);
      if (disposition === "approved") return "approved";
      if (disposition === "restricted") return "restricted";
    }
  }
  return null;
}

function windowCountForTexts(texts: Iterable<string>): number {
  let count = 0;
  for (const text of texts) {
    if (!text.trim()) continue;
    count += splitAdultOffGuardWindows(
      text,
      ADULT_OFF_GUARD_WINDOW_CHARS,
      ADULT_OFF_GUARD_WINDOW_OVERLAP_CHARS
    ).length;
  }
  return count;
}

function planUniqueTexts(
  rows: readonly AdultOffInspectionMessageRow[]
): {
  bodyUnique: string[];
  auxUnique: string[];
  unionUnique: string[];
  bodyWindows: number;
  auxOnlyWindows: number;
  unionWindows: number;
} {
  const plan = planAdultOffBatchInspection(rows);
  const bodyUnique = dedupeAdultOffClassificationTexts(plan);
  const bodySet = new Set(bodyUnique);
  const auxTexts = new Set<string>();
  const aux = surveyAdultOffAuxSurfaces(rows);
  for (const item of aux.items) {
    for (const text of item.texts) {
      if (text.trim()) auxTexts.add(text);
    }
  }
  const auxOnly = [...auxTexts].filter((text) => !bodySet.has(text));
  const union = new Set([...bodySet, ...auxTexts]);
  return {
    bodyUnique,
    auxUnique: [...auxTexts],
    unionUnique: [...union],
    bodyWindows: windowCountForTexts(bodyUnique),
    auxOnlyWindows: windowCountForTexts(auxOnly),
    unionWindows: windowCountForTexts(union),
  };
}

function usdToKrw(usd: number, rate: number): number {
  return usd * rate * 1.02;
}

async function classifyText(
  db: Database.Database,
  rows: readonly AdultOffInspectionMessageRow[],
  cache: TextOutcomeCache,
  text: string,
  messageId: number,
  chatId: number,
  rateKrwPerUsd: number,
  capKrw: number
): Promise<AdultOffInspectionOutcome> {
  const cached = cache.get(text);
  if (cached) return cached;
  const stored = storedDispositionForText(rows, text);
  if (stored) {
    cache.set(text, stored);
    return stored;
  }

  const spend = sumAdultOffBatchModerationSpend(db, RUN_ID);
  if (spend.unknownCostEvents > 0) {
    throw new Error("batch_moderation_spend_unknown: cannot trust cap with unknown ledger costs");
  }
  const spentKrw = usdToKrw(spend.settledUsd, rateKrwPerUsd);
  const nextWindowCost = CONSERVATIVE_KRW_PER_WINDOW;
  if (spentKrw + nextWindowCost > capKrw) {
    throw new Error(`batch_cap_exceeded: spent≈${spentKrw.toFixed(2)}KRW cap=${capKrw}`);
  }

  const classify = createAdultOffClassifier({
    chatId,
    assistantMessageId: messageId,
    generationSequence: 0,
    generationRequestId: buildAdultOffBatchGenerationRequestId(RUN_ID, messageId),
  });
  const decision = await evaluateAdultOffOutput([text], classify);
  const outcome = adultOffGuardDecisionToInspectionOutcome(decision);
  cache.set(text, outcome);
  return outcome;
}

async function main(): Promise<void> {
  if (getRemoteDatabaseConfig()) {
    console.error(JSON.stringify({ error: "remote_database_refused" }));
    process.exit(2);
  }
  const dbPath = getDatabasePath();
  const readonly = MODE === "plan";
  const db = new Database(dbPath, { readonly, fileMustExist: true });

  try {
    if (MODE === "execute" && isLiveProdDb(dbPath) && !ALLOW_PROD_WRITE) {
      console.error(
        JSON.stringify({
          error: "prod_write_refused",
          hint: "Set ADULT_OFF_BATCH_ALLOW_PROD_WRITE=1 after operator approval",
        })
      );
      process.exit(2);
    }
    if (MODE === "execute" && !APPROVE_PAID) {
      console.error(JSON.stringify({ error: "paid_not_approved", hint: "ADULT_OFF_BATCH_APPROVE_PAID=1" }));
      process.exit(2);
    }
    if (MODE === "execute" && !process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
      console.error(JSON.stringify({ error: "missing_cheaper_inference_api_key" }));
      process.exit(2);
    }

    const rows = loadAssistantRowsForAdultOffInspection(db);
    const summary = planAdultOffBatchInspectionSummary(planAdultOffBatchInspection(rows));
    const unique = planUniqueTexts(rows);
    const conservativeCost = unique.unionWindows * CONSERVATIVE_KRW_PER_WINDOW;
    const optimisticCost = unique.unionWindows * PROBE_MEAN_KRW;

    const chatIdByMessage = new Map<number, number>();
    const chatRows = db
      .prepare("SELECT id, chat_id FROM messages WHERE role='assistant'")
      .all() as Array<{ id: number; chat_id: number }>;
    for (const row of chatRows) chatIdByMessage.set(row.id, row.chat_id);

    const spend =
      MODE === "execute" ? sumAdultOffBatchModerationSpend(db, RUN_ID) : { settledUsd: 0, unknownCostEvents: 0, totalEvents: 0 };

    const planReport = {
      mode: MODE,
      runId: RUN_ID,
      dbPath,
      readonly,
      requestKind: ADULT_OFF_BATCH_MODERATION_REQUEST_KIND,
      targets: summary,
      uniqueTexts: {
        body: unique.bodyUnique.length,
        aux: unique.auxUnique.length,
        union: unique.unionUnique.length,
      },
      classifierWindows: {
        body: unique.bodyWindows,
        auxOnly: unique.auxOnlyWindows,
        union: unique.unionWindows,
      },
      costEstimateKrw: {
        conservative: Math.round(conservativeCost * 100) / 100,
        optimistic: Math.round(optimisticCost * 100) / 100,
        capKrw: CAP_KRW,
        underCapConservative: conservativeCost <= CAP_KRW,
      },
      ledgerSpendToDate: spend,
      approvePaid: APPROVE_PAID,
      allowProdWrite: ALLOW_PROD_WRITE,
    };

    if (MODE === "plan") {
      console.log(JSON.stringify({ ...planReport, status: "plan_only_ok" }, null, 2));
      return;
    }

    const rateKrwPerUsd = Number(process.env.ADULT_OFF_BATCH_USD_KRW ?? "1450");
    const cache: TextOutcomeCache = new Map();
    const bodyStats = {
      written: 0,
      writtenVariantIsolated: 0,
      skippedStale: 0,
      skippedNoop: 0,
      skippedUnresolved: 0,
      classified: 0,
    };
    const auxStats = {
      written: 0,
      skippedStale: 0,
      skippedNoop: 0,
      skippedUnresolved: 0,
    };

    const plan = planAdultOffBatchInspection(rows);
    const uniqueBodyTexts = dedupeAdultOffClassificationTexts(plan);
    for (const text of uniqueBodyTexts) {
      if (storedDispositionForText(rows, text)) continue;
      bodyStats.classified += 1;
    }

    for (const item of plan) {
      if (item.kind === "reuse_approved" || item.kind === "reuse_restricted" || item.kind === "skip_empty") {
        continue;
      }
      const text = item.target.text;
      const chatId = chatIdByMessage.get(item.target.messageId) ?? 0;
      let outcome: AdultOffInspectionOutcome;
      try {
        outcome = await classifyText(db, rows, cache, text, item.target.messageId, chatId, rateKrwPerUsd, CAP_KRW);
      } catch (error) {
        console.error(JSON.stringify({ error: String(error), partial: planReport, bodyStats, auxStats }, null, 2));
        process.exit(1);
      }
      const row = db
        .prepare(
          "SELECT id, role, content, model, usage, alternates, active_variant, status_meta, suggested_replies_json, status_widget_values_json FROM messages WHERE id=?"
        )
        .get(item.target.messageId) as AdultOffInspectionMessageRow;
      const result = commitAdultOffInspectionIfFresh(db, {
        fingerprint: fingerprintAdultOffInspectionTarget(row, item.target.variantIndex, text),
        expectedText: text,
        outcome,
      });
      switch (result) {
        case "written":
          bodyStats.written += 1;
          break;
        case "written_variant_isolated":
          bodyStats.writtenVariantIsolated += 1;
          break;
        case "skipped_stale":
          bodyStats.skippedStale += 1;
          break;
        case "skipped_noop":
          bodyStats.skippedNoop += 1;
          break;
        case "skipped_unresolved":
          bodyStats.skippedUnresolved += 1;
          break;
        default:
          break;
      }
    }

    rows = loadAssistantRowsForAdultOffInspection(db);
    const aux = surveyAdultOffAuxSurfaces(rows);
    for (const item of aux.items) {
      const texts = item.texts.filter((t) => t.trim());
      if (texts.length === 0) continue;
      const row = db
        .prepare(
          "SELECT id, role, content, model, usage, alternates, active_variant, status_meta, suggested_replies_json, status_widget_values_json FROM messages WHERE id=?"
        )
        .get(item.messageId) as AdultOffInspectionMessageRow;
      const fingerprint = fingerprintAdultOffAuxSurveyItem(row, item, db);
      if (!fingerprint) {
        auxStats.skippedStale += 1;
        continue;
      }
      const outcomes: AdultOffInspectionOutcome[] = [];
      for (const text of texts) {
        const chatId = chatIdByMessage.get(item.messageId) ?? 0;
        try {
          outcomes.push(
            await classifyText(db, rows, cache, text, item.messageId, chatId, rateKrwPerUsd, CAP_KRW)
          );
        } catch (error) {
          console.error(JSON.stringify({ error: String(error), partial: planReport, bodyStats, auxStats }, null, 2));
          process.exit(1);
        }
      }
      const result = commitAdultOffAuxSurveyItemIfFresh(db, {
        fingerprint,
        expectedTexts: texts,
        outcomes,
      });
      switch (result) {
        case "written":
          auxStats.written += 1;
          break;
        case "skipped_stale":
          auxStats.skippedStale += 1;
          break;
        case "skipped_noop":
          auxStats.skippedNoop += 1;
          break;
        case "skipped_unresolved":
          auxStats.skippedUnresolved += 1;
          break;
        default:
          break;
      }
    }

    const finalSpend = sumAdultOffBatchModerationSpend(db, RUN_ID);
    console.log(
      JSON.stringify(
        {
          ...planReport,
          status: "execute_finished",
          bodyStats,
          auxStats,
          ledgerSpendFinal: finalSpend,
          spentKrw: usdToKrw(finalSpend.settledUsd, rateKrwPerUsd),
        },
        null,
        2
      )
    );
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
