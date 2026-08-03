/**
 * Re-audit D0 length metrics from existing artifacts (does not modify source files).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { computeDialogueMetrics } from "../src/lib/dialogueMetrics";
import { visibleAssistantDisplayCharCount } from "../src/lib/chatDisplayLength";

const D0_DIR =
  process.env.D0_DIR ??
  "/opt/cursor/artifacts/deepseek-common-root-audit/02-ds-real-production";
const OUT_DIR =
  process.env.OUT_DIR ??
  "/opt/cursor/artifacts/deepseek-common-root-audit/00-integrity";

function readText(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

function charStats(text: string) {
  return {
    ws: text.length,
    no_ws: text.replace(/\s/g, "").length,
    visible_canonical: visibleAssistantDisplayCharCount(text),
  };
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const rows: Record<string, unknown>[] = [];
  const runs = readdirSync(D0_DIR)
    .filter((d) => /^run\d+$/.test(d))
    .sort();

  for (const run of runs) {
    const runNum = Number(run.replace("run", ""));
    const chatIdMatch = readText(join(D0_DIR, run, "turn1-metrics.json"));
    let chatId: number | null = null;
    try {
      chatId = (JSON.parse(chatIdMatch) as { api?: { chatId?: number } }).api?.chatId ?? null;
    } catch {
      /* ignore */
    }

    for (let turn = 1; turn <= 4; turn++) {
      const metricsPath = join(D0_DIR, run, `turn${turn}-metrics.json`);
      if (!existsSync(metricsPath)) continue;

      const providerRaw = readText(join(D0_DIR, run, `turn${turn}-provider-raw.txt`));
      const sseFinal = readText(join(D0_DIR, run, `turn${turn}-sse-final.txt`));
      const dbSaved = readText(join(D0_DIR, run, `turn${turn}-db-saved.txt`));
      const metricsJson = JSON.parse(readText(metricsPath)) as {
        api?: {
          latency_s?: number;
          model?: string;
          raw_equals_final?: boolean;
        };
        auto_provider?: ReturnType<typeof computeDialogueMetrics>;
      };

      const rawMetrics = computeDialogueMetrics({ text: providerRaw });
      const finalMetrics = computeDialogueMetrics({ text: sseFinal || providerRaw });
      const autoProvider = metricsJson.auto_provider;

      rows.push({
        run: runNum,
        chat_id: chatId,
        turn,
        provider_raw_ws: charStats(providerRaw).ws,
        provider_raw_no_ws: charStats(providerRaw).no_ws,
        final_ws: charStats(sseFinal).ws,
        db_saved_ws: charStats(dbSaved).ws,
        visible_canonical_length: charStats(sseFinal || providerRaw).visible_canonical,
        output_tokens: null,
        finish_reason: null,
        max_tokens_sent: null,
        provider: metricsJson.api?.model ?? "deepseek-v4-flash",
        latency_s: metricsJson.api?.latency_s ?? null,
        quote_blocks: finalMetrics.quote_pair_count,
        quote_blocks_raw: rawMetrics.quote_pair_count,
        semantic_utterance_units: finalMetrics.semantic_utterance_units_auto,
        semantic_utterance_units_raw: rawMetrics.semantic_utterance_units_auto,
        fragmentation_multiplier: finalMetrics.fragmentation_multiplier_auto,
        fragmentation_multiplier_raw: rawMetrics.fragmentation_multiplier_auto,
        resume_transitions: finalMetrics.resume_transitions_auto,
        resume_transitions_raw: rawMetrics.resume_transitions_auto,
        quote_blocks_per_1000: finalMetrics.quote_blocks_per_1000_chars,
        resume_per_1000: finalMetrics.resume_transitions_per_1000_chars,
        quote_blocks_per_1000_raw: rawMetrics.quote_blocks_per_1000_chars,
        resume_per_1000_raw: rawMetrics.resume_transitions_per_1000_chars,
        raw_equals_final: metricsJson.api?.raw_equals_final ?? providerRaw === sseFinal,
        owner_count: null,
        note:
          autoProvider && autoProvider.quote_pair_count !== finalMetrics.quote_pair_count
            ? "final metrics undercount quotes vs provider raw (display paragraph split)"
            : undefined,
      });
    }
  }

  const canonicals = rows.map((r) => Number(r.visible_canonical_length ?? r.final_ws ?? 0));
  const summary = {
    d0_status: "SHORT_OUTPUT_SMOKE_ONLY" as const,
    d0_previous_verdict_valid: false,
    sample_count: rows.length,
    canonical_avg: Math.round(canonicals.reduce((a, b) => a + b, 0) / Math.max(1, canonicals.length)),
    canonical_median: median(canonicals),
    canonical_min: canonicals.length ? Math.min(...canonicals) : 0,
    canonical_max: Math.max(...canonicals, 0),
    count_ge_3000: canonicals.filter((n) => n >= 3000).length,
    count_ge_2700: canonicals.filter((n) => n >= 2700).length,
    count_lt_2400: canonicals.filter((n) => n < 2400).length,
    count_lt_1500: canonicals.filter((n) => n < 1500).length,
    count_lt_1000: canonicals.filter((n) => n < 1000).length,
    length_gate_pass: false,
    audit_permission: "LENGTH_BASELINE_NOT_READY" as const,
    rows,
  };

  if (summary.count_lt_2400 === 0 && summary.count_ge_2700 >= 5 && summary.canonical_avg >= 3000) {
    summary.d0_status = "AWAITING_LENGTH_INTEGRITY_AUDIT";
    summary.length_gate_pass = true;
    summary.audit_permission = "FULL_COMMON_ROOT_MATRIX_ALLOWED";
  } else if (summary.count_lt_2400 === summary.sample_count) {
    summary.d0_status = "SHORT_OUTPUT_SMOKE_ONLY";
  }

  writeFileSync(join(OUT_DIR, "D0_LENGTH_REAUDIT.json"), JSON.stringify(summary, null, 2), "utf8");

  const mdLines = [
    "# D0 Length Re-audit",
    "",
    `Status: **${summary.d0_status}**`,
    `Previous fragmentation verdict valid: **NO** (length not qualified)`,
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `| --- | ---: |`,
    `| samples | ${summary.sample_count} |`,
    `| canonical avg | ${summary.canonical_avg} |`,
    `| median | ${summary.canonical_median} |`,
    `| min | ${summary.canonical_min} |`,
    `| max | ${summary.canonical_max} |`,
    `| >= 3000 | ${summary.count_ge_3000}/${summary.sample_count} |`,
    `| >= 2700 | ${summary.count_ge_2700}/${summary.sample_count} |`,
    `| < 2400 | ${summary.count_lt_2400}/${summary.sample_count} |`,
    `| < 1500 | ${summary.count_lt_1500}/${summary.sample_count} |`,
    `| < 1000 | ${summary.count_lt_1000}/${summary.sample_count} |`,
    `| length gate | ${summary.length_gate_pass ? "PASS" : "FAIL"} |`,
    "",
    "## Per-output",
    "",
    "| Run | Turn | Chat | Prov RAW ws | Final ws | Visible | Quotes (raw/final) | Resume (raw/final) | Frag raw | /1000 raw |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: |",
  ];

  for (const r of rows) {
    mdLines.push(
      `| ${r.run} | ${r.turn} | ${r.chat_id ?? "—"} | ${r.provider_raw_ws} | ${r.final_ws} | ${r.visible_canonical_length} | ${r.quote_blocks_raw}/${r.quote_blocks} | ${r.resume_transitions_raw}/${r.resume_transitions} | ${r.fragmentation_multiplier_raw} | ${r.quote_blocks_per_1000_raw} |`
    );
  }

  mdLines.push(
    "",
    "## Note",
    "",
    "Harness `final` metrics used display-transformed SSE text; provider RAW retains full dialogue. Use RAW columns for fragmentation until length gate passes.",
    ""
  );

  writeFileSync(join(OUT_DIR, "D0_LENGTH_REAUDIT.md"), mdLines.join("\n"), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main();
