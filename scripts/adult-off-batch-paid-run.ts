/**
 * Adult OFF batch moderation — PLAN_ONLY by default; paid execution needs explicit approval.
 *
 *   node --conditions=react-server --import tsx scripts/adult-off-batch-paid-run.ts
 *
 * Recommended order: PLAN_ONLY against the live DB (read-only), then ONE approved execute against the live DB.
 * Proofs are written only to the DB being executed; there is no way to carry them from an isolated copy to
 * production without re-classifying, so an isolated paid run is not a path to production completion.
 *
 * One approved batch = one budget. RUN_ID is only a label; spend, cap, halt flag and the execution lock live in a
 * fixed per-user location (~/.hav-adult-off-batch) and are not configurable by environment variables.
 *
 * Env (all validated before any database is opened):
 *   ADULT_OFF_BATCH_MODE=plan|execute            exactly these two values (default plan)
 *   ADULT_OFF_BATCH_RUN_ID=...                   required for execute; label only; [A-Za-z0-9._-]{3,64}
 *   ADULT_OFF_BATCH_CAP_KRW=1500                 required for execute; finite positive; never auto-raised
 *   ADULT_OFF_BATCH_APPROVE_PAID=1               required for execute
 *   ADULT_OFF_BATCH_ALLOW_PROD_WRITE=1           required when DATA_DIR resolves to the live volume DB
 *   ADULT_OFF_BATCH_ALLOW_ISOLATED_PAID=1        required to spend the shared budget on a non-production DB
 *   ADULT_OFF_BATCH_CAP_RAISE_FROM_KRW=...       required to raise the cap: must equal the previously approved cap
 *   ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID=.. accept one re-classification after an interrupted call (id is printed)
 *   ADULT_OFF_BATCH_USD_KRW=1450                 optional; finite positive
 *   ADULT_OFF_BATCH_RESERVE_KRW_PER_WINDOW=0.45  optional minimum per-call reserve; the real per-call bound is
 *                                                computed from request bytes, max_tokens and provider rates
 *   CHEAPER_INFERENCE_API_KEY                    required for execute
 *   DATA_DIR                                     sqlite directory
 */
import Database from "better-sqlite3";
import { getDatabasePath, getRemoteDatabaseConfig } from "@/lib/dataDir";
import { createAdultOffClassifier } from "@/lib/adultOffOutputClassifier";
import {
  AdultOffBatchConfigError,
  AdultOffBatchRunRefusedError,
  buildAdultOffBatchPlanReport,
  executeAdultOffBatchPaidRun,
  parseAdultOffBatchPaidRunConfig,
} from "@/lib/adultOffBatchPaidRun";

function fail(code: string, message: string): never {
  console.error(JSON.stringify({ status: "refused", code, message }));
  process.exit(2);
}

async function main(): Promise<void> {
  if (getRemoteDatabaseConfig()) fail("remote_database_refused", "remote database is not supported");

  let config: ReturnType<typeof parseAdultOffBatchPaidRunConfig>;
  try {
    config = parseAdultOffBatchPaidRunConfig(process.env, getDatabasePath());
  } catch (error) {
    if (error instanceof AdultOffBatchConfigError) fail(error.code, error.message);
    throw error;
  }

  if (config.mode === "plan") {
    const db = new Database(config.dbPath, { readonly: true, fileMustExist: true });
    try {
      console.log(JSON.stringify(buildAdultOffBatchPlanReport(db, config), null, 2));
    } finally {
      db.close();
    }
    return;
  }

  try {
    const report = await executeAdultOffBatchPaidRun({
      config,
      openDatabase: () => new Database(config.dbPath, { fileMustExist: true }),
      createClassifier: createAdultOffClassifier,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.status === "execute_stopped") process.exitCode = 1;
  } catch (error) {
    if (error instanceof AdultOffBatchRunRefusedError) fail(error.code, error.message);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
