/**
 * C-3A: VACUUM INTO isolated copy + synthetic batch rehearsal + aux dedupe + cost scope.
 * Never reads/writes production /data/app.db except readonly VACUUM INTO source.
 *
 *   SOURCE_DB=/data/app.db DEST_DB=/data/private/... node --conditions=react-server --import tsx scripts/adult-off-batch-c3a-rehearsal.ts
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  assessActiveVariantCanonicalMirror,
  commitAdultOffInspectionIfFresh,
  copySqliteDatabaseForRehearsal,
  fingerprintAdultOffInspectionTarget,
  loadAssistantRowsForAdultOffInspection,
  planAdultOffBatchInspection,
  dedupeAdultOffClassificationTexts,
  runAdultOffBatchInspectionRehearsal,
  surveyAdultOffAuxSurfaces,
  surveyAdultOffBatchReadOnly,
  summarizeActiveRowMirror,
  sqliteIntegrityCheck,
  type AdultOffInspectionMessageRow,
} from "@/lib/adultOffBatchInspectionPrep";
import {
  ADULT_OFF_GUARD_POLICY_VERSION,
  ADULT_OFF_GUARD_WINDOW_CHARS,
  ADULT_OFF_GUARD_WINDOW_OVERLAP_CHARS,
  ADULT_OFF_CLASSIFIER_SYSTEM_PROMPT,
  adultOffStoredTextDisposition,
  presentAdultOffStoredRead,
  splitAdultOffGuardWindows,
} from "@/lib/adultOffOutputGuard";
import { normalizeMessageVariants } from "@/lib/messageAlternates";

const SOURCE_DB = process.env.SOURCE_DB?.trim() || "/data/app.db";
const DEST_DB =
  process.env.DEST_DB?.trim() ||
  path.join("/data/private", `adult-off-c3a-${Date.now()}.db`);

/** Conservative per classifier window (live probe p95-ish on short windows). */
const CONSERVATIVE_COST_KRW_PER_WINDOW = Number(process.env.C3A_COST_KRW_PER_WINDOW ?? "0.45");
const CONSERVATIVE_LATENCY_MS_PER_WINDOW = Number(process.env.C3A_LATENCY_MS_PER_WINDOW ?? "2800");
const USD_KRW = Number(process.env.C3A_USD_KRW ?? "1450");
const INPUT_TOKENS_PER_WINDOW = Number(process.env.C3A_INPUT_TOKENS_PER_WINDOW ?? "4200");
const OUTPUT_TOKENS_PER_WINDOW = Number(process.env.C3A_OUTPUT_TOKENS_PER_WINDOW ?? "80");

function sha256File(pathname: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(pathname));
  return hash.digest("hex");
}

function messagesIntegrity(db: Database.Database): string {
  const row = db.prepare("PRAGMA integrity_check(messages)").get() as {
    integrity_check?: string;
  };
  return row.integrity_check ?? "unknown";
}

function usageWithoutGuard(raw: string | null | undefined): string {
  if (!raw?.trim()) return "null";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const { adultOffGuard: _g, ...rest } = parsed;
    return JSON.stringify(rest);
  } catch {
    return raw;
  }
}

function settlementDigest(db: Database.Database): string {
  const rows = db
    .prepare(
      `SELECT id, content, model, usage, alternates, active_variant, request_id
       FROM messages WHERE role='assistant' ORDER BY id`
    )
    .all() as Array<{
    id: number;
    content: string;
    model: string | null;
    usage: string | null;
    alternates: string | null;
    active_variant: number | null;
    request_id: string | null;
  }>;
  const hash = createHash("sha256");
  for (const row of rows) {
    hash.update(String(row.id));
    hash.update("\0");
    hash.update(row.content);
    hash.update("\0");
    hash.update(row.model ?? "");
    hash.update("\0");
    hash.update(usageWithoutGuard(row.usage));
    hash.update("\0");
    hash.update(row.alternates ?? "");
    hash.update("\0");
    hash.update(String(row.active_variant ?? 0));
    hash.update("\0");
    hash.update(row.request_id ?? "");
    hash.update("\n");
  }
  return hash.digest("hex");
}

function ledgerDigest(db: Database.Database): string | null {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%point%'")
    .all() as Array<{ name: string }>;
  if (tables.length === 0) return null;
  const hash = createHash("sha256");
  for (const { name } of tables) {
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number }).c;
    hash.update(`${name}:${count};`);
  }
  return hash.digest("hex");
}

function collectGuardHashes(db: Database.Database): string[] {
  const rows = db.prepare("SELECT usage, alternates FROM messages WHERE role='assistant'").all() as Array<{
    usage: string | null;
    alternates: string | null;
  }>;
  const hashes: string[] = [];
  const pushFromUsage = (raw: string | null) => {
    if (!raw?.trim()) return;
    try {
      const usage = JSON.parse(raw) as { adultOffGuard?: { approvedTextHashes?: unknown } };
      const list = usage.adultOffGuard?.approvedTextHashes;
      if (Array.isArray(list)) {
        for (const h of list) {
          if (typeof h === "string") hashes.push(h);
        }
      }
    } catch {
      /* ignore */
    }
  };
  for (const row of rows) {
    pushFromUsage(row.usage);
    if (row.alternates?.trim()) {
      try {
        const variants = JSON.parse(row.alternates) as Array<{ usage?: unknown }>;
        for (const variant of variants) {
          if (variant.usage && typeof variant.usage === "object") {
            pushFromUsage(JSON.stringify(variant.usage));
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  return hashes;
}

function auxDedupeReport(rows: readonly AdultOffInspectionMessageRow[], bodyUniqueTexts: Set<string>) {
  const aux = surveyAdultOffAuxSurfaces(rows);
  const displayWidget = new Set<string>();
  const inactiveWidget = new Set<string>();
  const suggestedReply = new Set<string>();
  const statusMeta = new Set<string>();
  const allAux = new Set<string>();

  for (const item of aux.items) {
    for (const text of item.texts) {
      if (!text.trim()) continue;
      allAux.add(text);
      switch (item.surface) {
        case "status_widget":
          displayWidget.add(text);
          break;
        case "status_widget_inactive":
          inactiveWidget.add(text);
          break;
        case "suggested_replies":
          suggestedReply.add(text);
          break;
        case "status_meta":
          statusMeta.add(text);
          break;
        default:
          break;
      }
    }
  }

  let exactBodyMatch = 0;
  for (const text of allAux) {
    if (bodyUniqueTexts.has(text)) exactBodyMatch += 1;
  }

  const auxOnlyUnique = [...allAux].filter((t) => !bodyUniqueTexts.has(t));

  function windowCallCount(texts: readonly string[]): number {
    let calls = 0;
    for (const text of texts) {
      calls += splitAdultOffGuardWindows(
        text,
        ADULT_OFF_GUARD_WINDOW_CHARS,
        ADULT_OFF_GUARD_WINDOW_OVERLAP_CHARS
      ).length;
    }
    return calls;
  }

  const bodyTexts = [...bodyUniqueTexts];
  const bodyWindowCalls = windowCallCount(bodyTexts);
  const auxOnlyWindowCalls = windowCallCount(auxOnlyUnique);
  const unionTexts = new Set([...bodyUniqueTexts, ...allAux]);
  const unionWindowCalls = windowCallCount([...unionTexts]);

  return {
    uniqueDisplayWidgetStrings: displayWidget.size,
    uniqueInactiveWidgetStrings: inactiveWidget.size,
    uniqueSuggestedReplyStrings: suggestedReply.size,
    uniqueStatusMetaStrings: statusMeta.size,
    auxStringsExactMatchBody: exactBodyMatch,
    auxUniqueStringsAfterExactDedupe: allAux.size,
    auxOnlyUniqueStrings: auxOnlyUnique.length,
    classifierWindowCallsBody808: bodyWindowCalls,
    classifierWindowCallsAuxOnly: auxOnlyWindowCalls,
    classifierWindowCallsUnionDedupe: unionWindowCalls,
    promptChars: ADULT_OFF_CLASSIFIER_SYSTEM_PROMPT.length,
  };
}

function verifyStructuralMetadataPreserved(
  before: readonly AdultOffInspectionMessageRow[],
  after: readonly AdultOffInspectionMessageRow[]
): { ok: boolean; regressions: number[] } {
  const byBefore = new Map(before.map((r) => [r.id, r]));
  const regressions: number[] = [];
  for (const row of after) {
    const prior = byBefore.get(row.id);
    if (!prior) continue;
    const { variants: v0, activeVariant: a0 } = normalizeMessageVariants({
      content: prior.content,
      model: prior.model ?? "",
      usage: prior.usage,
      alternates: prior.alternates,
      active_variant: prior.active_variant,
    });
    const { variants: v1, activeVariant: a1 } = normalizeMessageVariants({
      content: row.content,
      model: row.model ?? "",
      usage: row.usage,
      alternates: row.alternates,
      active_variant: row.active_variant,
    });
    const assessment = assessActiveVariantCanonicalMirror(row, v1, a1);
    if (!assessment.structuralMetadataOnly && !assessment.mirrors) {
      regressions.push(row.id);
      continue;
    }
    if (prior.content !== row.content || prior.model !== row.model) {
      regressions.push(row.id);
      continue;
    }
    if (usageWithoutGuard(prior.usage) !== usageWithoutGuard(row.usage)) {
      regressions.push(row.id);
    }
    if (prior.alternates !== row.alternates && prior.alternates && row.alternates) {
      const pVariants = v0;
      const nVariants = v1;
      if (pVariants.length !== nVariants.length) {
        regressions.push(row.id);
        continue;
      }
      for (let i = 0; i < pVariants.length; i += 1) {
        if (pVariants[i]?.content !== nVariants[i]?.content) regressions.push(row.id);
        const pu = pVariants[i]?.usage;
        const nu = nVariants[i]?.usage;
        if (JSON.stringify(pu) !== JSON.stringify(nu)) {
          const strip = (u: unknown) => {
            if (!u || typeof u !== "object") return u;
            const { adultOffGuard: _g, ...rest } = u as Record<string, unknown>;
            return rest;
          };
          if (JSON.stringify(strip(pu)) !== JSON.stringify(strip(nu))) {
            regressions.push(row.id);
          }
        }
      }
    }
    void a0;
  }
  return { ok: regressions.length === 0, regressions: [...new Set(regressions)] };
}

function simulateGuardRead(row: AdultOffInspectionMessageRow, applyGuard: boolean) {
  const { variants, activeVariant } = normalizeMessageVariants({
    content: row.content,
    model: row.model ?? "",
    usage: row.usage,
    alternates: row.alternates,
    active_variant: row.active_variant,
  });
  return presentAdultOffStoredRead({
    applyGuard,
    rowContent: row.content,
    variants,
    activeVariant,
  });
}

function main(): void {
  if (!fs.existsSync(SOURCE_DB)) {
    console.error(JSON.stringify({ error: "missing_source", SOURCE_DB }));
    process.exit(2);
  }

  const sourceStatBefore = fs.statSync(SOURCE_DB);
  const sourceHashBefore = sha256File(SOURCE_DB);

  if (fs.existsSync(DEST_DB)) {
    console.error(JSON.stringify({ error: "dest_exists", DEST_DB }));
    process.exit(2);
  }

  copySqliteDatabaseForRehearsal(SOURCE_DB, DEST_DB);

  const sourceStatAfter = fs.statSync(SOURCE_DB);
  const sourceHashAfter = sha256File(SOURCE_DB);

  const db = new Database(DEST_DB);
  try {
    const integrityFull = sqliteIntegrityCheck(db);
    const integrityMessages = messagesIntegrity(db);

    const rowsBefore = loadAssistantRowsForAdultOffInspection(db);
    const surveyBefore = surveyAdultOffBatchReadOnly(rowsBefore);
    const settlementBefore = settlementDigest(db);
    const ledgerBefore = ledgerDigest(db);

    const plan = planAdultOffBatchInspection(rowsBefore);
    const bodyUnique = new Set(dedupeAdultOffClassificationTexts(plan));
    const auxReport = auxDedupeReport(rowsBefore, bodyUnique);

    const classify = () => "approved" as const;
    const first = runAdultOffBatchInspectionRehearsal(db, classify);
    const rowsMid = loadAssistantRowsForAdultOffInspection(db);
    const second = runAdultOffBatchInspectionRehearsal(db, classify);

    const rowsAfter = loadAssistantRowsForAdultOffInspection(db);
    const surveyAfter = surveyAdultOffBatchReadOnly(rowsAfter);
    const settlementAfter = settlementDigest(db);
    const ledgerAfter = ledgerDigest(db);

    const structuralCheck = verifyStructuralMetadataPreserved(rowsBefore, rowsAfter);
    const guardHashes = collectGuardHashes(db);
    const hashCounts = new Map<string, number>();
    for (const h of guardHashes) {
      hashCounts.set(h, (hashCounts.get(h) ?? 0) + 1);
    }
    const duplicateHashEntries = [...hashCounts.entries()].filter(([, c]) => c > 1).length;

    const contentMismatchIds = summarizeActiveRowMirror(rowsBefore).contentMismatchMessageIds;
    const isolationProof: Record<string, unknown> = {};
    for (const id of contentMismatchIds) {
      const row = db
        .prepare(
          "SELECT id, content, usage, alternates, active_variant FROM messages WHERE id=?"
        )
        .get(id) as AdultOffInspectionMessageRow;
      const { variants, activeVariant } = normalizeMessageVariants({
        content: row.content,
        model: row.model ?? "",
        usage: row.usage,
        alternates: row.alternates,
        active_variant: row.active_variant,
      });
      const activeText = variants[activeVariant]?.content ?? "";
      const rowGuard = adultOffStoredTextDisposition(JSON.parse(row.usage || "{}"), activeText);
      const variantGuard = adultOffStoredTextDisposition(variants[activeVariant]?.usage, activeText);
      const guardOn = simulateGuardRead(row, true);
      const guardOff = simulateGuardRead(row, false);
      isolationProof[String(id)] = {
        rowContentLen: row.content.length,
        displayedLen: guardOff.content.length,
        rowUsageHasProofForDisplayed: rowGuard === "approved",
        variantUsageHasProofForDisplayed: variantGuard === "approved",
        guardOnWithheld: guardOn.withheld,
        guardOnVisibleLen: guardOn.content.length,
      };
    }

    const failClosedOk = (() => {
      const probe = db
        .prepare(
          `SELECT id, role, content, model, usage, alternates, active_variant FROM messages
           WHERE role='assistant' AND length(trim(content))>0 LIMIT 1`
        )
        .get() as AdultOffInspectionMessageRow | undefined;
      if (!probe) return { ok: false, reason: "no_probe_row" };
      const text = probe.content;
      const fp = fingerprintAdultOffInspectionTarget(probe, probe.active_variant ?? 0, text);
      commitAdultOffInspectionIfFresh(db, {
        fingerprint: fp,
        expectedText: text,
        outcome: "restricted",
      });
      const reread = db
        .prepare(
          "SELECT id, role, content, model, usage, alternates, active_variant FROM messages WHERE id=?"
        )
        .get(probe.id) as AdultOffInspectionMessageRow;
      const guarded = simulateGuardRead(reread, true);
      return { ok: guarded.withheld || guarded.content === "", messageId: probe.id };
    })();

    const rehearsalSuccess =
      first.written + first.writtenVariantIsolated === first.targetCount &&
      first.skippedStale === 0 &&
      first.skippedUnresolved === 0 &&
      second.written === 0 &&
      second.skippedNoop + second.reuseApproved === second.targetCount &&
      settlementBefore === settlementAfter &&
      ledgerBefore === ledgerAfter &&
      structuralCheck.ok &&
      duplicateHashEntries === 0 &&
      failClosedOk.ok === true;

    const totalWindows = auxReport.classifierWindowCallsUnionDedupe;
    const conservativeCostKrw = totalWindows * CONSERVATIVE_COST_KRW_PER_WINDOW;
    const conservativeLatencyMin = (totalWindows * CONSERVATIVE_LATENCY_MS_PER_WINDOW) / 60_000;

    const report = {
      deployExpectation: "2d1f5185c838caa57842f205a72bad669354ecd9",
      sourceDb: SOURCE_DB,
      destDb: DEST_DB,
      sourceUnchanged: {
        sizeBefore: sourceStatBefore.size,
        sizeAfter: sourceStatAfter.size,
        mtimeBefore: sourceStatBefore.mtimeMs,
        mtimeAfter: sourceStatAfter.mtimeMs,
        sha256Before: sourceHashBefore,
        sha256After: sourceHashAfter,
      },
      integrity: { full: integrityFull, messages: integrityMessages },
      surveyBefore: surveyBefore.body,
      surveyAfter: surveyAfter.body,
      mirrorAfter: {
        structuralUsageMetadataMessages: surveyAfter.body.structuralUsageMetadataMessages,
        settlementMismatchMessages: surveyAfter.body.settlementMismatchMessages,
        contentMismatchMessages: surveyAfter.body.contentMismatchMessages,
      },
      rehearsal: {
        success: rehearsalSuccess,
        firstPass: first,
        secondPass: second,
        contentMismatchIsolation: isolationProof,
        failClosedRestricted: failClosedOk,
        structuralMetadataPreserved: structuralCheck,
        duplicateApprovedHashValues: duplicateHashEntries,
      },
      aux: auxReport,
      paidScope: {
        uniqueBodyStrings: bodyUnique.size,
        conservativeClassifierWindows: totalWindows,
        conservativeCostKrw: Math.round(conservativeCostKrw * 100) / 100,
        budgetKrw: 1000,
        underBudget: conservativeCostKrw < 1000,
        needsApprovalOverBudget: conservativeCostKrw >= 1000,
        estimatedInputTokens: totalWindows * INPUT_TOKENS_PER_WINDOW,
        estimatedOutputTokens: totalWindows * OUTPUT_TOKENS_PER_WINDOW,
        usdKrwAssumption: USD_KRW,
        estimatedLatencyMinutesSequential: Math.round(conservativeLatencyMin * 10) / 10,
        executionPath:
          "Isolated copy or DATA_DIR snapshot; node --conditions=react-server --import tsx scripts/adult-off-guard-reanalyze.ts pattern with CHEAPER_INFERENCE + cap env; body batch via planAdultOffBatchInspection + dedupeAdultOffClassificationTexts; aux per-string classify via adultOffOutputClassifier owner; commit via commitAdultOffInspectionIfFresh only.",
        pauseResume:
          "Per-text checkpoint: commit after each unique string/window; rerun skips reuse_approved via v2 hashes.",
        incremental:
          "New assistant rows append targets; replan dedupes; only needs_classification strings invoke paid calls.",
      },
      c3Verdict: rehearsalSuccess && conservativeCostKrw < 1000 ? "READY" : rehearsalSuccess ? "READY_PENDING_BUDGET" : "BLOCKED",
      policyVersion: ADULT_OFF_GUARD_POLICY_VERSION,
    };

    console.log(JSON.stringify(report, null, 2));
    process.exit(rehearsalSuccess ? 0 : 1);
  } finally {
    db.close();
  }
}

main();
