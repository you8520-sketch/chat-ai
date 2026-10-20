/**
 * Read-only adult-OFF batch prep survey (no writes, no paid classifier calls).
 *
 * Usage:
 *   DATA_DIR=/path/to/prod-copy tsx scripts/adult-off-batch-prep-survey.ts
 *
 * Prints aggregate counts and SHA-256 summaries only — never RP plaintext.
 */
import Database from "better-sqlite3";
import { getDatabasePath, getRemoteDatabaseConfig } from "@/lib/dataDir";
import {
  loadAssistantRowsForAdultOffInspection,
  planAdultOffBatchInspection,
  planAdultOffBatchInspectionSummary,
  surveyAdultOffAuxSurfaces,
  sqliteIntegrityCheck,
} from "@/lib/adultOffBatchInspectionPrep";
import { ADULT_OFF_GUARD_POLICY_VERSION } from "@/lib/adultOffOutputGuard";

function main(): void {
  if (getRemoteDatabaseConfig()) {
    console.error("Refusing remote/Turso database for read-only survey.");
    process.exit(2);
  }
  const dbPath = getDatabasePath();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = sqliteIntegrityCheck(db);
    const rows = loadAssistantRowsForAdultOffInspection(db);
    const plan = planAdultOffBatchInspection(rows);
    const summary = planAdultOffBatchInspectionSummary(plan);
    const aux = surveyAdultOffAuxSurfaces(rows);
    const report = {
      databasePath: dbPath,
      integrity,
      policyVersion: ADULT_OFF_GUARD_POLICY_VERSION,
      inspection: summary,
      aux: {
        displayStatusMetaMessages: aux.displayStatusMetaMessages,
        suggestedReplyMessages: aux.suggestedReplyMessages,
        variantWidgetTextCount: aux.variantWidgetTextCount,
        auxTextItems: aux.auxTextItems,
        auxItemsMissingV2Proof: aux.auxItemsMissingV2Proof,
        auxItemsWithUnapprovedVisibleText: aux.auxItemsWithUnapprovedVisibleText,
      },
      note: "No message plaintext included. Use isolated copy + rehearsal tests before any paid batch.",
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    db.close();
  }
}

main();
