/**
 * CLI — Main RP monthly prompt-cache audit (read-only).
 * provider generation calls = 0 · no production prompt/routing/billing changes.
 *
 * Usage:
 *   node --conditions=react-server --import tsx scripts/main-rp-monthly-cache-audit.ts
 *   MAIN_RP_CACHE_AUDIT_YEAR_MONTH=2026-08 ... (optional UTC calendar month)
 *   MAIN_RP_CACHE_AUDIT_OUT_DIR=... (optional artifact directory)
 *
 * Credentials (usage/reporting only — never production inference key):
 *   CHEAPER_INFERENCE_USAGE_API_KEY (preferred)
 *   CHEAPER_INFERENCE_BENCHMARK_API_KEY (compat fallback)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import {
  resolveUsageReportingCheaperInferenceApiKey,
  sanitizeUsageReportingCredentialText,
} from "./lib/cheaperInferenceUsageReportingCredential";
import {
  assertActiveModelsTrackRegistry,
  buildMonthlyCacheAuditReport,
  buildNotRunMonthlyCacheAuditReport,
  buildPriorMonthCacheReadRatios,
  calendarMonthWindowFromYearMonth,
  countSecretLeakageMarkers,
  fetchCatalogPricingForModels,
  fetchUsageRequestsPages,
  previousCalendarMonthWindow,
  priorCalendarMonthWindow,
  renderMonthlyCacheAuditMarkdown,
  resolveMainRpMonthlyCacheAuditModels,
} from "./lib/mainRpMonthlyCacheAudit";

const RETIRED_REFERENCE_IDS = ["deepseek-v4-pro-0813"] as const;

async function main(): Promise<void> {
  const yearMonthEnv = process.env.MAIN_RP_CACHE_AUDIT_YEAR_MONTH?.trim();
  const window = yearMonthEnv
    ? calendarMonthWindowFromYearMonth(yearMonthEnv)
    : previousCalendarMonthWindow();

  const activeModelIds = resolveMainRpMonthlyCacheAuditModels(MAIN_RP_MODEL_IDS);
  assertActiveModelsTrackRegistry(activeModelIds, MAIN_RP_MODEL_IDS);

  const credential = resolveUsageReportingCheaperInferenceApiKey();
  if (!credential.ok) {
    const report = buildNotRunMonthlyCacheAuditReport({
      window,
      reason:
        "missing_usage_reporting_credential — set CHEAPER_INFERENCE_USAGE_API_KEY " +
        "(preferred) or CHEAPER_INFERENCE_BENCHMARK_API_KEY; production " +
        "CHEAPER_INFERENCE_API_KEY is never used (no inference fallback)",
      activeModelIds,
      knownRetiredModelIds: RETIRED_REFERENCE_IDS,
    });
    const markdown = renderMonthlyCacheAuditMarkdown(report);
    writeArtifacts(window.yearMonth, report, markdown);
    console.log(
      JSON.stringify(
        {
          runStatus: report.runStatus,
          notRunReason: report.notRunReason,
          providerGenerationCalls: report.providerGenerationCalls,
          activeModelIds: report.activeModelIds,
          yearMonth: window.yearMonth,
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  try {
    const usage = await fetchUsageRequestsPages({
      apiKey: credential.apiKey,
      startAt: window.startAt,
      endAt: window.endAt,
    });
    const priorWindow = priorCalendarMonthWindow(window);
    const priorUsage = await fetchUsageRequestsPages({
      apiKey: credential.apiKey,
      startAt: priorWindow.startAt,
      endAt: priorWindow.endAt,
    });
    const priorMonthRatios = priorUsage.paginationComplete
      ? buildPriorMonthCacheReadRatios(priorUsage.rows, activeModelIds)
      : undefined;
    const catalogByModel = await fetchCatalogPricingForModels({
      apiKey: credential.apiKey,
      modelIds: activeModelIds,
    });

    const report = buildMonthlyCacheAuditReport({
      window,
      activeModelIds,
      knownRetiredModelIds: RETIRED_REFERENCE_IDS,
      usageRows: usage.rows,
      catalogByModel,
      pagesScanned: usage.pagesScanned,
      paginationComplete: usage.paginationComplete,
      priorMonthRatios,
      credentialSource: credential.source,
      runStatus:
        usage.paginationComplete && priorUsage.paginationComplete ? "OK" : "INCOMPLETE",
      notRunReason: null,
    });

    const markdown = renderMonthlyCacheAuditMarkdown(report);
    const serialized = JSON.stringify(report);
    if (countSecretLeakageMarkers(serialized) > 0) {
      throw new Error("secret leakage detected in audit JSON");
    }
    if (countSecretLeakageMarkers(markdown) > 0) {
      throw new Error("secret leakage detected in audit markdown");
    }

    const outDir = writeArtifacts(window.yearMonth, report, markdown);
    console.log(
      JSON.stringify(
        {
          runStatus: report.runStatus,
          yearMonth: window.yearMonth,
          providerGenerationCalls: report.providerGenerationCalls,
          activeModelIds: report.activeModelIds,
          retiredModelsExcluded: report.retiredModelsExcluded,
          classifications: report.classifications,
          alertFingerprints: report.alertFingerprints,
          pagesScanned: report.query.pagesScanned,
          paginationComplete: report.query.paginationComplete,
          totalRequestsScanned: report.query.totalRequestsScanned,
          priorYearMonth: priorWindow.yearMonth,
          priorPagesScanned: priorUsage.pagesScanned,
          priorPaginationComplete: priorUsage.paginationComplete,
          outDir,
          credentialSource: report.credentialSource,
        },
        null,
        2
      )
    );
  } catch (error) {
    const message = sanitizeUsageReportingCredentialText(
      (error as Error).message || String(error)
    );
    console.error(message);
    process.exit(1);
  }
}

function writeArtifacts(
  yearMonth: string,
  report: ReturnType<typeof buildMonthlyCacheAuditReport>,
  markdown: string
): string {
  const outDir =
    process.env.MAIN_RP_CACHE_AUDIT_OUT_DIR?.trim() ||
    join("docs", "audits", `main-rp-monthly-cache-${yearMonth}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, "REPORT.md"), markdown);
  return outDir;
}

main().catch((error) => {
  console.error(
    sanitizeUsageReportingCredentialText((error as Error).message || String(error))
  );
  process.exit(1);
});
