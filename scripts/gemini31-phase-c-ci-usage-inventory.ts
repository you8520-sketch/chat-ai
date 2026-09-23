/**
 * Phase C.1 — read-only CI usage key inventory (no prompt/response bodies).
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-c-ci-usage-inventory.ts
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { runPhaseCTurn } from "./lib/gemini31PhaseCCollect";

loadEnvLocal();

const OUT = "/opt/cursor/artifacts/gemini31-phase-c-ttft/ci-usage-inventory.json";

async function main() {
  console.log("CI usage inventory: 2 diagnostic turns (key inventory only, no bodies)");
  const { token, chatId, characterId } = await runPhaseCTurn.setupSession("A");
  const samples = [];

  for (let i = 0; i < 2; i++) {
    const record = await runPhaseCTurn.consumeTurn({
      token,
      characterId,
      chatId,
      fixture: "A",
      turnIndex: i + 1,
      message: runPhaseCTurn.LIVE_MEASURE_TURNS[i]!,
      captureUsageInventory: true,
    });
    samples.push({
      turnIndex: i + 1,
      usage_key_inventory: record.usage_key_inventory ?? [],
      response_headers: record.response_headers ?? {},
      cache_read_tokens_reported: record.cache_read_tokens_reported,
      cached_tokens: record.cached_tokens,
      provider_billed_cost_usd: record.provider_billed_cost_usd,
      user_charge_points: record.user_charge_points,
    });
    if (i === 0) await new Promise((r) => setTimeout(r, 3000));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    DOES_CI_RAW_RESPONSE_REPORT_PREFIX_CACHE_USAGE:
      samples.some((s) =>
        s.usage_key_inventory.some((k) =>
          /cache_read|cached_tokens|cache_read_input|prompt_tokens_details\.cached/i.test(k)
        )
      )
        ? "PARTIAL_KEY_PRESENCE_CHECK_ONLY"
        : "NO_CACHE_KEYS_IN_DONE_USAGE",
    CI_EXACT_MATCH_CACHE_NOTE:
      "x-ci-cache hit/miss (if present) is CI gateway exact-match — separate from Gemini prefix cache",
    samples,
    parser_note:
      "parseOpenRouterUsage() collapses missing cache fields to numeric 0; done.usage omits cacheReadTokens when 0",
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
