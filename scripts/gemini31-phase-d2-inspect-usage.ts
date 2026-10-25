import { loadEnvLocal } from "./load-env-local";
import { fetchAllCiUsageInWindow } from "./lib/gemini31PhaseD2Usage";

loadEnvLocal();

async function main() {
  const f = await fetchAllCiUsageInWindow("2026-08-30T03:50:00Z", "2026-08-30T05:00:00Z", 5);
  console.log("count", f.records.length);
  console.log(JSON.stringify(f.records.slice(0, 2), null, 2));
  const target = "gen-1788064161-ywWgDMxjNOdcenHhFfeN";
  console.log("hit", f.records.some((r) => JSON.stringify(r).includes(target)));
  const gemini = f.records.filter((r) => String(r.model ?? "").includes("gemini-3.1"));
  console.log("gemini31", gemini.length);
  if (gemini[0]) {
    console.log(
      "sample",
      gemini[0].request_id,
      gemini[0].time_to_first_token_ms,
      gemini[0].cache_read_input_tokens
    );
  }
}

main().catch(console.error);
