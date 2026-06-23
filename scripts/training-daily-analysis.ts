/**
 * RP training daily tag analysis — manual or cron entrypoint
 * Usage: npm run training:analyze
 */
import { loadEnvLocal } from "./load-env-local";
import { runDailyTrainingAnalysis } from "../src/lib/training/dailyAnalysis";

loadEnvLocal();

runDailyTrainingAnalysis()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
