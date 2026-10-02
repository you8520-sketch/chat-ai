/**
 * Read-only inventory of existing audit / scheduler / report owners.
 * The code-health system attaches to these owners; it does not replace them.
 */
export const CODE_HEALTH_OWNER_MAP = Object.freeze({
  githubScheduledWorkflows: {
    responsibility: "Repo-level scheduled read-only audits and research cycles",
    paths: [
      ".github/workflows/memory-research-cycle.yml",
      ".github/workflows/main-rp-monthly-cache-audit.yml",
      ".github/workflows/main-rp-supply-radar.yml",
      ".github/workflows/code-health-weekly-audit.yml",
      ".github/workflows/code-health-monthly-cleanup.yml",
    ],
  },
  railwayDurableScheduler: {
    responsibility: "In-process production time-slot jobs against the canonical DB",
    paths: [
      "src/lib/schedulerDefinitions.ts",
      "src/lib/schedulerRunRegistry.ts",
      "src/cron/financeScheduler.ts",
      "src/cron/payoutScheduler.ts",
      "src/cron/trainingScheduler.ts",
      "src/cron/mainRpCacheTtlAuditScheduler.ts",
      "server.js",
    ],
  },
  adminAutomationReports: {
    responsibility: "Settings → 관리자 → 자동화 보고서 read-only hub",
    paths: [
      "src/app/admin/automation-reports/page.tsx",
      "src/lib/adminAutomationReports.ts",
      "src/lib/githubReportClient.ts",
      "src/lib/codeHealth/reports.ts",
    ],
  },
  adminOpsInbox: {
    responsibility: "Incident / exception owner — not a code-health surface",
    paths: ["src/app/admin/ops/page.tsx", "src/lib/adminOpsInbox.ts"],
  },
  ciOwners: {
    responsibility: "PR lint / typecheck / build / focused validation workflows",
    paths: [
      "package.json",
      "tsconfig.app.json",
      ".github/workflows/validate-scheduler-durability.yml",
      ".github/workflows/validate-dependency-security.yml",
      ".github/workflows/validate-code-health-audit.yml",
    ],
  },
  dependencyMaintenance: {
    responsibility: "Production npm audit baseline — not unused-export analysis",
    paths: ["scripts/dependency-security/checkProductionNpmAudit.ts"],
  },
  featureFlagEnvInventory: {
    responsibility: "Documented env / flag inventory",
    paths: [".env.example"],
  },
  dbSchemaOwner: {
    responsibility: "SQLite schema + in-process migrations",
    paths: ["src/lib/db.ts"],
  },
  promptOwners: {
    responsibility: "Prompt assembly / section fingerprint / existing duplicate audit",
    paths: [
      "src/services/contextBuilder.ts",
      "src/lib/corePrompt.ts",
      "src/lib/promptSectionFingerprint.ts",
      "src/lib/statusWidget/promptDuplicateAudit.ts",
    ],
  },
  modelAdapterOwners: {
    responsibility: "Selectable models, published pricing, shared-novel adapters",
    paths: [
      "src/lib/chatModels.ts",
      "src/lib/sharedNovelProseModelAdapters.ts",
      "src/lib/modelPublishedPricingPolicy.ts",
    ],
  },
  weeklyCodeHealthAudit: {
    responsibility: "Read-only weekly candidate discovery — never patches production",
    paths: [
      "src/lib/codeHealth/audit.ts",
      "scripts/code-health-audit.ts",
      ".github/workflows/code-health-weekly-audit.yml",
    ],
  },
  monthlyCodeHealthCleanup: {
    responsibility: "Bounded cleanup candidate set + optional Draft PR, never auto-merge",
    paths: [
      "src/lib/codeHealth/cleanup.ts",
      "scripts/code-health-monthly-cleanup.ts",
      ".github/workflows/code-health-monthly-cleanup.yml",
    ],
  },
});

export const KNIP_REVIEW_REASON =
  "Knip was reviewed as a TypeScript-aware unused-file/export/dependency scanner. " +
  "It is not adopted as a canonical owner: Next.js App Router entries, dynamic import(), " +
  "scheduler-only modules, scripts, migrations, tests, and runtime provider adapters " +
  "produce deletion-unsafe false positives. This audit uses a first-party import graph " +
  "plus evidence gates. Analyzer hits are candidates, never deletion proof.";

export const RAILWAY_SCHEDULER_JOBS_UNCHANGED = [
  "finance_daily",
  "main_rp_cache_ttl_monthly",
  "payout_monthly",
  "training_daily",
  "training_weekly",
] as const;
