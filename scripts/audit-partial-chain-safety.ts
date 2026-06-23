/**
 * Partial-chain safety audit — compares stop_after A/C vs D/E on collected beat-completion samples.
 * Measurement only; no API calls, no prompt changes.
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-partial-chain-safety.ts
 */
import fs from "fs";
import path from "path";

const ACTION_VERB_PATTERN =
  /(?:잡|뻗|돌|움직|내밀|당기|밀|끌|걸|열|닫|일어나|앉|서|향하|다가|물러|옮기|만지|쓰다듬|끌어안|내려놓|확|들|놓|고개|손|손가락|무릎|다리|몸|어깨|시선|응시|바라|품|안|키스|입|혀|벗|벗기|풀|늘|접|굽|펴|쓸|문|닿|스치|밀착|감싸|안아|끌어|당겨|밀어|쓰다|내려|올려|기울|숙|일으|눕|눌|쥐|풀어|벌|맞|교차|감|쓸어|문지|삼|삼키|핥|빨|쏟|흘|번|떨|경련|떨리|떨림|떨렸|떨었다)(?:았|었|였|는|다|며|고|아|어|였다|했다|인다|ㄴ다)?/;

type BeatRow = {
  model_id: string;
  turn_number: number;
  stop_after: string;
  partial_chain_stop: boolean;
  response_char_count: number;
  omitted_beats: number;
  estimated_remaining_beats: number;
  total_beats: number;
  beats: Array<{ source: string; text_preview: string }>;
};

type EndingRow = {
  model_id: string;
  turn_number: number;
  response_char_count: number;
  action_count: number;
  narration_paragraph_count: number;
  missed_continuation_points: { estimated_additional_beats: number };
};

type EnrichedRow = BeatRow & {
  chain_group: "partial" | "complete";
  action_count_est: number;
  narration_paragraph_count_est: number;
  missed_continuation_est: number;
  action_count_ending?: number;
  narration_paragraph_count_ending?: number;
  missed_continuation_ending?: number;
};

function isPartial(stop_after: string): boolean {
  return stop_after === "A_initiation" || stop_after === "C_follow_through";
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function pctDiff(partialAvg: number, completeAvg: number): number {
  if (completeAvg === 0) return 0;
  return ((completeAvg - partialAvg) / completeAvg) * 100;
}

function findLatestBeatCompletionLog(outDir: string): string {
  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith("beat-completion-audit-") && f.endsWith(".jsonl"))
    .sort()
    .reverse();
  if (!files.length) throw new Error("No beat-completion-audit jsonl found in output/");
  return path.join(outDir, files[0]);
}

function findLatestEndingLog(outDir: string): string | null {
  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith("ending-behavior-audit-") && f.endsWith(".jsonl"))
    .sort()
    .reverse();
  return files.length ? path.join(outDir, files[0]) : null;
}

function enrich(row: BeatRow): EnrichedRow {
  const narrBeats = row.beats.filter((b) => b.source === "narration").length;
  const action_count_est = row.beats.filter((b) => ACTION_VERB_PATTERN.test(b.text_preview)).length;
  const narration_paragraph_count_est = Math.max(1, Math.ceil(narrBeats / 3));

  return {
    ...row,
    chain_group: isPartial(row.stop_after) ? "partial" : "complete",
    action_count_est,
    narration_paragraph_count_est,
    missed_continuation_est: row.estimated_remaining_beats,
  };
}

function buildReport(rows: EnrichedRow[]): string {
  const partial = rows.filter((r) => r.chain_group === "partial");
  const complete = rows.filter((r) => r.chain_group === "complete");

  const lines: string[] = [
    "=".repeat(72),
    "PARTIAL-CHAIN SAFETY AUDIT (pre-TURN_HANDOFF)",
    `generated: ${new Date().toISOString()}`,
    `samples: ${rows.length} (partial A/C: ${partial.length}, complete D/E: ${complete.length})`,
    "=".repeat(72),
    "",
    "Source: beat-completion-audit jsonl (same fixture/models as prior audits)",
    "Partial = stop_after A_initiation or C_follow_through",
    "Complete = stop_after D_consequence or E_true_pause",
    "",
  ];

  const metrics: Array<{
    label: string;
    partialKey: keyof EnrichedRow;
    completeKey: keyof EnrichedRow;
  }> = [
    { label: "response_char_count", partialKey: "response_char_count", completeKey: "response_char_count" },
    {
      label: "narration_paragraph_count (est. from beats)",
      partialKey: "narration_paragraph_count_est",
      completeKey: "narration_paragraph_count_est",
    },
    { label: "action_count (est. from beats)", partialKey: "action_count_est", completeKey: "action_count_est" },
    { label: "omitted_beats", partialKey: "omitted_beats", completeKey: "omitted_beats" },
    {
      label: "missed_continuation_points (est. remaining beats)",
      partialKey: "missed_continuation_est",
      completeKey: "missed_continuation_est",
    },
  ];

  lines.push("## Global comparison (partial A/C vs complete D/E)");
  lines.push("");
  lines.push("| Metric | Partial avg | Complete avg | Δ (complete−partial) | % shorter if partial |");
  lines.push("|--------|-------------|--------------|----------------------|----------------------|");

  let charPctShorter = 0;
  for (const m of metrics) {
    const pAvg = avg(partial.map((r) => r[m.partialKey] as number));
    const cAvg = avg(complete.map((r) => r[m.completeKey] as number));
    const delta = cAvg - pAvg;
    const pct = pctDiff(pAvg, cAvg);
    if (m.label.startsWith("response_char")) charPctShorter = pct;
    lines.push(
      `| ${m.label} | ${pAvg.toFixed(1)} | ${cAvg.toFixed(1)} | ${delta.toFixed(1)} | ${pct.toFixed(1)}% |`
    );
  }
  lines.push("");

  const endingRows = rows.filter((r) => r.action_count_ending != null);
  if (endingRows.length) {
    lines.push("## Cross-check: ending-behavior audit (same model×turn, different generation)");
    lines.push("");
    const pEnd = endingRows.filter((r) => r.chain_group === "partial");
    const cEnd = endingRows.filter((r) => r.chain_group === "complete");
    lines.push(
      `chars partial avg ${avg(pEnd.map((r) => r.response_char_count)).toFixed(0)} vs complete ${avg(cEnd.map((r) => r.response_char_count)).toFixed(0)}`
    );
    lines.push(
      `action_count partial avg ${avg(pEnd.map((r) => r.action_count_ending!)).toFixed(1)} vs complete ${avg(cEnd.map((r) => r.action_count_ending!)).toFixed(1)}`
    );
    lines.push(
      `narr_paras partial avg ${avg(pEnd.map((r) => r.narration_paragraph_count_ending!)).toFixed(1)} vs complete ${avg(cEnd.map((r) => r.narration_paragraph_count_ending!)).toFixed(1)}`
    );
    lines.push(
      `missed_beats partial avg ${avg(pEnd.map((r) => r.missed_continuation_ending!)).toFixed(1)} vs complete ${avg(cEnd.map((r) => r.missed_continuation_ending!)).toFixed(1)}`
    );
    lines.push("");
  }

  lines.push("## Per-model breakdown (beat-completion cohort)");
  lines.push("");

  const models = [...new Set(rows.map((r) => r.model_id))];
  const modelCharPct: Array<{ model: string; pct: number; partialN: number; completeN: number }> = [];

  for (const model of models) {
    const subset = rows.filter((r) => r.model_id === model);
    const p = subset.filter((r) => r.chain_group === "partial");
    const c = subset.filter((r) => r.chain_group === "complete");
    const pChars = avg(p.map((r) => r.response_char_count));
    const cChars = avg(c.map((r) => r.response_char_count));
    const pct = pctDiff(pChars, cChars);

    lines.push(`### ${model}`);
    lines.push(`  partial n=${p.length} avg_chars=${pChars.toFixed(0)} | complete n=${c.length} avg_chars=${cChars.toFixed(0)} | partial shorter by ${pct.toFixed(1)}%`);
    for (const r of subset) {
      lines.push(
        `    t=${r.turn_number} ${r.stop_after} ${r.chain_group} chars=${r.response_char_count} beats=${r.total_beats} omitted=${r.omitted_beats}`
      );
    }
    lines.push("");

    if (p.length && c.length) modelCharPct.push({ model, pct, partialN: p.length, completeN: c.length });
  }

  lines.push("## Consistency check (per-sample char count)");
  lines.push("");
  let partialShorterCount = 0;
  for (const r of partial) {
    const cAvgPeer = avg(
      complete.filter((c) => c.model_id === r.model_id).map((c) => c.response_char_count)
    );
    const shorter = r.response_char_count < cAvgPeer;
    if (shorter) partialShorterCount++;
    lines.push(
      `  ${r.model_id.split("/").pop()} t=${r.turn_number} partial ${r.response_char_count} vs same-model complete avg ${cAvgPeer.toFixed(0)} → ${shorter ? "SHORTER" : "NOT shorter"}`
    );
  }
  lines.push(`  partial shorter than same-model complete avg: ${partialShorterCount}/${partial.length}`);
  lines.push("");

  const recommendIntervention = charPctShorter > 20;
  lines.push("## Recommendation");
  lines.push("");
  if (recommendIntervention) {
    lines.push(
      `Global partial-chain responses are ~${charPctShorter.toFixed(1)}% shorter than complete-chain (>${20}% threshold).`
    );
    lines.push("Partial-chain stopping may contribute materially to short outputs — TURN_HANDOFF intervention warrants testing.");
  } else {
    lines.push(
      `Global partial-chain responses are only ~${charPctShorter.toFixed(1)}% shorter than complete-chain (≤${20}% threshold).`
    );
    lines.push(
      "Partial-chain behavior appears to be a symptom, not the primary driver of short outputs. Do not prioritize TURN_HANDOFF changes based on chain completeness alone."
    );
  }

  if (modelCharPct.length) {
    const mostAffected = modelCharPct.sort((a, b) => b.pct - a.pct)[0];
    lines.push(`Most affected model (where both groups exist): ${mostAffected.model} (${mostAffected.pct.toFixed(1)}% shorter when partial)`);
  }

  const deepPartial = rows.filter((r) => r.model_id.includes("deepseek") && r.chain_group === "partial");
  const deepComplete = rows.filter((r) => r.model_id.includes("deepseek") && r.chain_group === "complete");
  if (deepPartial.length && deepComplete.length) {
    const dp = pctDiff(avg(deepPartial.map((r) => r.response_char_count)), avg(deepComplete.map((r) => r.response_char_count)));
    lines.push(`DeepSeek partial vs complete char gap: ${dp.toFixed(1)}%`);
  }

  return lines.join("\n");
}

function main() {
  const outDir = path.join(process.cwd(), "output");
  const beatPath = findLatestBeatCompletionLog(outDir);
  const endingPath = findLatestEndingLog(outDir);

  const beatRows: BeatRow[] = fs
    .readFileSync(beatPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

  const endingMap = new Map<string, EndingRow>();
  if (endingPath) {
    const endingRows: EndingRow[] = fs
      .readFileSync(endingPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    for (const e of endingRows) {
      endingMap.set(`${e.model_id}|${e.turn_number}`, e);
    }
  }

  const enriched: EnrichedRow[] = beatRows.map((row) => {
    const e = enrich(row);
    const key = `${row.model_id}|${row.turn_number}`;
    const end = endingMap.get(key);
    if (end) {
      e.action_count_ending = end.action_count;
      e.narration_paragraph_count_ending = end.narration_paragraph_count;
      e.missed_continuation_ending = end.missed_continuation_points.estimated_additional_beats;
    }
    return e;
  });

  const report = buildReport(enriched);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = path.join(outDir, `partial-chain-safety-audit-${stamp}.txt`);
  fs.writeFileSync(reportPath, report, "utf8");

  console.log(report);
  console.log(`\nReport: ${reportPath}`);
  console.log(`Beat source: ${beatPath}`);
  if (endingPath) console.log(`Ending cross-check: ${endingPath}`);
}

main();
