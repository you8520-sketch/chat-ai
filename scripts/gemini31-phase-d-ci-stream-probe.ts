/**
 * Phase D §6 — Raw CI stream capability probe (2–3 calls, key inventory only).
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-d-ci-stream-probe.ts
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnvLocal } from "./load-env-local";
import {
  PHASE_D_MINIMAL_SYSTEM,
  PHASE_D_USER_TURNS,
  probeProviderStream,
} from "./lib/gemini31PhaseDProbe";

loadEnvLocal();

const OUT_DIR = "/opt/cursor/artifacts/gemini31-phase-d-reasoning";
const OUT = path.join(OUT_DIR, "ci-stream-probe.json");

async function main() {
  console.log("PHASE_D_CI_STREAM_PROBE — 3 read-only CI calls (key inventory only)");
  const samples = [];

  for (let i = 0; i < 3; i++) {
    const userTurns = PHASE_D_USER_TURNS.slice(0, i + 1);
    const messages = userTurns.flatMap((u, idx) => {
      const pair: Array<{ role: "user" | "assistant"; content: string }> = [{ role: "user", content: u }];
      return pair;
    });
    // Multi-turn: only user messages for probe 1; for probes 2-3 we'd need prior assistant replies
    // Probe 1: single turn. Probes 2-3: use accumulated history from prior probes in-process.
    if (i > 0) {
      // rebuild from prior sample assistant visible content is NOT stored — use fresh single-turn variants
    }

    const probeMessages =
      i === 0
        ? [{ role: "user" as const, content: PHASE_D_USER_TURNS[0]! }]
        : i === 1
          ? [
              { role: "user" as const, content: PHASE_D_USER_TURNS[0]! },
              { role: "assistant" as const, content: "(이전 턴 응답 — visible only placeholder for shape probe)" },
              { role: "user" as const, content: PHASE_D_USER_TURNS[1]! },
            ]
          : [
              { role: "user" as const, content: PHASE_D_USER_TURNS[0]! },
              { role: "assistant" as const, content: "(이전 턴 응답 — visible only)" },
              { role: "user" as const, content: PHASE_D_USER_TURNS[1]! },
              { role: "assistant" as const, content: "(두 번째 턴 visible only)" },
              { role: "user" as const, content: PHASE_D_USER_TURNS[2]! },
            ];

    console.log(`\n--- Probe ${i + 1}/3 (${probeMessages.length} messages) ---`);
    const result = await probeProviderStream({
      provider: "cheaperinference",
      messages: probeMessages,
      systemPrompt: PHASE_D_MINIMAL_SYSTEM,
    });

    samples.push({
      probeIndex: i + 1,
      messageCount: probeMessages.length,
      requestBodyKeys: result.requestBodyKeys,
      reasoning_effort: result.reasoningEffort,
      thinking: result.thinking,
      reasoning: result.reasoning,
      first_sse_ms: result.firstSseMs,
      first_visible_ms: result.firstVisibleMs,
      pre_visible_gap_ms: result.preVisibleGapMs,
      provider_complete_ms: result.providerCompleteMs,
      reasoning_tokens: result.reasoningTokens,
      visible_chars: result.visibleChars,
      finish_reason: result.finishReason,
      reasoning_details_present_any: result.reasoningDetailsPresentAny,
      reasoning_details_block_count_max: result.reasoningDetailsBlockCountMax,
      reasoning_details_bytes_total: result.reasoningDetailsBytesTotal,
      empty_content_metadata_chunks: result.emptyContentMetadataChunks,
      final_assistant_keys: result.finalAssistantKeys,
      chunk_count: result.chunkInventories.length,
      delta_key_union: [
        ...new Set(result.chunkInventories.flatMap((c) => c.deltaKeys)),
      ].sort(),
      reasoning_details_type_union: [
        ...new Set(
          result.chunkInventories.flatMap((c) =>
            c.reasoningDetailsSummaries.map((s) => s.type).filter(Boolean) as string[]
          )
        ),
      ],
      signature_like_keys_union: [
        ...new Set(result.chunkInventories.flatMap((c) => c.signatureLikeKeys)),
      ],
      chunk_inventories: result.chunkInventories.map((c) => ({
        chunkIndex: c.chunkIndex,
        deltaKeys: c.deltaKeys,
        reasoningPresent: c.reasoningPresent,
        reasoningByteLength: c.reasoningByteLength,
        reasoningDetailsPresent: c.reasoningDetailsPresent,
        reasoningDetailsBlockCount: c.reasoningDetailsBlockCount,
        reasoningDetailsSummaries: c.reasoningDetailsSummaries,
        emptyContentChunk: c.emptyContentChunk,
        hasUsage: c.hasUsage,
        finishReason: c.finishReason,
        signatureLikeKeys: c.signatureLikeKeys,
      })),
    });

    if (i < 2) await new Promise((r) => setTimeout(r, 2000));
  }

  const anyDetails = samples.some((s) => s.reasoning_details_present_any);
  const anySignature = samples.some((s) => s.signature_like_keys_union.length > 0);
  const anyEmptyMeta = samples.some((s) => s.empty_content_metadata_chunks > 0);

  const report = {
    generatedAt: new Date().toISOString(),
    DOES_CI_RETURN_REASONING_DETAILS: anyDetails ? "YES" : "NO",
    DOES_CI_RETURN_GEMINI_SIGNATURE: anySignature ? "YES" : "NO",
    EMPTY_CONTENT_METADATA_CHUNKS_OBSERVED: anyEmptyMeta,
    REASONING_CONTINUITY_DROP_POINT_IF_APP_IGNORES:
      anyDetails || anyEmptyMeta
        ? "openRouterAdult.ts extractOpenRouterStreamDelta — only delta.content/text; reasoning_details ignored when empty content"
        : "N/A — CI did not return usable continuity metadata in probe",
    samples,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log("\n" + JSON.stringify(report, null, 2));
  console.log("\nWritten:", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
