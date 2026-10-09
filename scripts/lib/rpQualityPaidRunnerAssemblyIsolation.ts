/**
 * First import of the live operator CLI. Redirects DATA_DIR to a scratch
 * folder so later assembler/getDb imports cannot open or migrate the
 * production volume. Does not patch fetch and does not delete experiment keys.
 * Raw production rows are read only via loadPrecallProductionRows(original path).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const paidRunnerOriginalDataDir = process.env.DATA_DIR ?? "";
export const paidRunnerScratchDataDir = mkdtempSync(path.join(tmpdir(), "rpq-live-scratch-data-"));
process.env.DATA_DIR = paidRunnerScratchDataDir;
process.env.PLAYWRIGHT_PROD_SERVER = "1";
