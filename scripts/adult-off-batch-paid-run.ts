/**
 * Adult OFF batch moderation — PLAN_ONLY by default; paid execution needs explicit approval.
 *
 *   node --conditions=react-server --import tsx scripts/adult-off-batch-paid-run.ts
 *
 * Env (all validated before any database is opened):
 *   ADULT_OFF_BATCH_MODE=plan|execute            exactly these two values (default plan)
 *   ADULT_OFF_BATCH_RUN_ID=...                   required for execute; [A-Za-z0-9._-]{3,64}
 *   ADULT_OFF_BATCH_CAP_KRW=1500                 required for execute; finite positive
 *   ADULT_OFF_BATCH_APPROVE_PAID=1               required for execute
 *   ADULT_OFF_BATCH_STATE_DIR=/abs/path          required for execute; run state + global lock
 *   ADULT_OFF_BATCH_USD_KRW=1450                 optional; finite positive
 *   ADULT_OFF_BATCH_RESERVE_KRW_PER_WINDOW=0.45  optional; finite positive (estimate, not a maximum)
 *   ADULT_OFF_BATCH_ALLOW_PROD_WRITE=1           required when DATA_DIR resolves to the live volume DB
 *   CHEAPER_INFERENCE_API_KEY                    required for execute
 *   DATA_DIR                                     sqlite directory (isolated copy recommended first)
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
