/**
 * Join Phase D.2 alias runs to CI usage API via x-ci-request-id.
 */
import fs from "node:fs";

import { loadEnvLocal } from "./load-env-local";
import {
  classifyCacheField,
  closestTtftTarget,
  fetchAllCiUsageInWindow,
  indexUsageByRequestId,
  pickRequestId,
} from "./lib/gemini31PhaseD2Usage";

loadEnvLocal();

const ALIAS = "/opt/cursor/artifacts/gemini31-phase-d2-reasoning/reasoning-alias.json";
const OUT = "/opt/cursor/artifacts/gemini31-phase-d2-reasoning/alias-usage-join.json";

async function main() {
  const alias = JSON.parse(fs.readFileSync(ALIAS, "utf8")) as {
    runs: Array<Record<string, unknown>>;
  };
  const fetched = await fetchAllCiUsageInWindow("2026-08-30T04:50:00Z", "2026-08-30T05:10:00Z", 5);
  const index = indexUsageByRequestId(fetched.records);
  let matched = 0;
  const joined = alias.runs.map((run) => {
    const id = String(run.ci_request_id ?? "");
    const usage = id ? index.get(id) : undefined;
    if (usage) matched += 1;
    const usageTtft =
      typeof usage?.time_to_first_token_ms === "number" ? usage.time_to_first_token_ms : null;
    const ttft = closestTtftTarget(usageTtft, {
      first_sse: typeof run.request_to_first_sse_ms === "number" ? run.request_to_first_sse_ms : null,
      first_reasoning:
        typeof run.request_to_first_reasoning_ms === "number" ? run.request_to_first_reasoning_ms : null,
      first_visible:
        typeof run.request_to_first_visible_ms === "number" ? run.request_to_first_visible_ms : null,
    });
    return {
      variant: run.variant,
      ci_request_id: id,
      usage_record_id: usage ? pickRequestId(usage) : null,
      matched: !!usage,
      reasoning_tokens: run.reasoning_tokens,
      time_to_first_token_ms: usageTtft,
      total_latency_ms: usage?.total_latency_ms ?? null,
      cache_read_input_tokens: usage?.cache_read_input_tokens ?? null,
      cache_write_input_tokens: usage?.cache_write_input_tokens ?? null,
      cache_read_class: classifyCacheField(usage?.cache_read_input_tokens),
      created_at: usage?.created_at ?? null,
      completed_at: usage?.completed_at ?? null,
      ttft_closest_to: ttft.closest,
      ttft_deltas: ttft.deltas,
      x_ci_cache: run.x_ci_cache ?? null,
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    ALIAS_RUNS: alias.runs.length,
    ALIAS_USAGE_MATCHED: `${matched}/${alias.runs.length}`,
    joined,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
