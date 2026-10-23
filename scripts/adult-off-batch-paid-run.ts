/**
 * Adult OFF batch moderation — PLAN_ONLY by default; paid execution needs explicit approval.
 *
 *   node --conditions=react-server --import tsx scripts/adult-off-batch-paid-run.ts
 *
 * Recommended order: PLAN_ONLY against the live DB (read-only), then ONE approved execute against the live DB.
 * Proofs are written only to the DB being executed; there is no way to carry them from an isolated copy to
 * production without re-classifying, so an isolated paid run is not a path to production completion.
 *
 * One approved batch = one budget. RUN_ID is only a label; spend, cap, pinned USD/KRW rate and provider rates, halt
 * flag and the execution lock live in ONE fixed place that environment variables cannot move:
 *   - the persistent volume's `<volume>/private/adult-off-batch` (0700) when /data (or RAILWAY_VOLUME_MOUNT_PATH)
 *     is a mounted volume; a live-DB execute is refused unless this is confirmed;
 *   - otherwise a fixed per-user directory (~/.hav-adult-off-batch) for development and isolated rehearsals.
 *
 * Before the first paid execute: run PLAN_ONLY, check the provider's CURRENT model rates yourself, then pass the
 * rates it printed back as ADULT_OFF_BATCH_APPROVED_RATES and choose a conservative ADULT_OFF_BATCH_USD_KRW.
 * Both are pinned; any later change stops the batch.
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
 *   ADULT_OFF_BATCH_USD_KRW=1450                 required for execute; conservative KRW per USD in [1300, 3000]; pinned
 *   ADULT_OFF_BATCH_APPROVED_RATES=0.07/0.35     required for execute; input/output USD per 1M exactly as PLAN_ONLY shows
 *   ADULT_OFF_BATCH_RESERVE_KRW_PER_WINDOW=0.45  optional minimum per-call reserve; the real per-call bound is
 *                                                computed from request bytes, max_tokens and provider rates
 *   CHEAPER_INFERENCE_API_KEY                    required for execute
 *   DATA_DIR                                     sqlite directory
 *
 * Each batch classifier call is a single attempt with a 60 s client timeout (ADULT_OFF_BATCH_CLASSIFIER_TIMEOUT_MS); the
 * synchronous chat guard keeps its own 25 s limit. A failed call is never retried automatically and prints one structured
 * line (outcome, HTTP status, whether a response was received, elapsed ms) to stderr and into the report.
 *
 * One-time recovery approvals (each group needs ALL of its variables, copied exactly from the inspected evidence;
 * leave them unset in every other run):
 *   ADULT_OFF_BATCH_QUARANTINE_RUN_ID / _REQUEST_ID / _EVENT_KEY / _MESSAGE_ID  [+ optional _LEDGER_STATUS]
 *     Isolate ONE interrupted call whose ledger row is a single cost-less, provider-id-less `started` event (default) or
 *     `failed_without_usage` event (set ADULT_OFF_BATCH_QUARANTINE_LEDGER_STATUS=failed_without_usage; the row must match
 *     exactly). The row is never edited or settled. A reserve (the recorded per-call bound, raised to the proven window
 *     bound at a 2.5x cache-write multiplier) is held against the cap instead of 0 KRW, and that call's text is never sent
 *     again from any message. Several calls can be quarantined one approval at a time; their reserves add up against the
 *     same cap and each is settled on its own. The run reports `quarantine_pending` until real billing of every held call
 *     is confirmed through the existing cost reconciliation; then each reserve is released and the usual ACK flow applies.
 *     If the batch is halted as `halted_unknown_cost` because of exactly that call (halt detail, in-flight marker, request
 *     id, event_key and message id all agree, no other unknown-cost event exists, settled + all reserves fit the cap), the
 *     same approval enrolls the quarantine and clears ONLY that halt in a single state save. Any other halt stays.
 *     Without a match nothing is changed.
 *   ADULT_OFF_BATCH_RECLAIM_LOCK_HOST / _PID / _RUN_ID / _STARTED_AT
 *     Take over an `execution.lock` left by a previous container. Every value must equal the lock file, the lock and
 *     batch.state.json must be unchanged for 10 minutes, and the lock must not belong to the current deployment. Confirm
 *     in Railway first that the old deployment is REMOVED. The old lock is moved to `execution.lock.reclaimed.*`, not deleted.
 *     Creating and reclaiming the lock both hold `execution.lock.reclaim` (wx). If that file is left behind, every run
 *     is refused until an operator has reviewed the lock directory; it is never deleted automatically.
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
      onClassifierFailure: (failure) => console.error(JSON.stringify({ event: "adult_off_batch_classifier_failure", ...failure })),
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
