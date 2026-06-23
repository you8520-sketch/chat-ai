/**
 * RP training weekly dataset export — manual or cron entrypoint
 * Usage: npm run training:export
 */
import { loadEnvLocal } from "./load-env-local";
import { runWeeklyTrainingExport } from "../src/lib/training/weeklyExport";

loadEnvLocal();

try {
  const result = runWeeklyTrainingExport();
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
