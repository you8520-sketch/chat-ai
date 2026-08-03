/**
 * Re-analyze existing Pro baseline RAW samples with manual semantic metrics (D0 §7).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { computeDialogueMetrics } from "../src/lib/dialogueMetrics";

const ROOT =
  process.env.ART_ROOT ??
  "/opt/cursor/artifacts/deepseek-common-root-audit/02-ds-pro-real-production";

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

function npcHeuristics(text: string) {
  const staff: string[] = [];
  for (const m of text.matchAll(/[“"]([^”"\n]+)[”"]/g)) {
    const q = m[1]!;
    const before = text.slice(Math.max(0, m.index! - 140), m.index!);
    if (
      /(직원|스태프|간호사|의사|안내원|담당자|의료진|윤태건|태건)/.test(before) ||
      /(신원\s*대조|바이탈|임시\s*등록|기본\s*확인부터|안쪽으로\s*안내|등록\s*정보)/.test(q)
    ) {
      staff.push(q);
    }
  }
  return {
    external_dialogue_blocks: staff.length,
    npc_subplot: staff.length >= 2,
  };
}

function main() {
  const samples: unknown[] = [];
  const mdLines = [
    "# Pro baseline D0 — manual semantic review v2",
    "",
    "Metrics source: **provider RAW** only. Display grouping quote counts excluded.",
    "",
    "| Run | Turn | RAW ws | Quotes | Manual units | Manual resume | Manual frag | Auto unreliable | NPC |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
  ];

  for (let r = 1; r <= 3; r++) {
    for (let t = 1; t <= 2; t++) {
      const rawPath = join(ROOT, `run${r}`, `turn${t}-provider-raw.txt`);
      if (!existsSync(rawPath)) continue;
      const text = readFileSync(rawPath, "utf8");
      const m = computeDialogueMetrics({ text, primaryCharacterName: "라이크" });
      const npc = npcHeuristics(text);
      const trailing = /([?？]|어때|할래|갈래|뭐\s*해|봐|여기|따라와|같이\s*가|골라|선택|믿어도|말해봐|괜찮)/.test(
        text.slice(-320)
      );
      const row = {
        run: r,
        turn: t,
        provider_raw_ws: m.canonical_length_ws,
        raw_quote_blocks: m.raw_quote_blocks,
        auto_semantic_units: m.auto_semantic_units,
        manual_semantic_units: m.manual_semantic_units,
        auto_resume_transitions: m.auto_resume_transitions,
        manual_resume_transitions: m.manual_resume_transitions,
        auto_fragmentation_multiplier: m.auto_fragmentation_multiplier,
        manual_fragmentation_multiplier: m.manual_fragmentation_multiplier,
        raw_quote_blocks_per_1000_chars: m.raw_quote_blocks_per_1000_chars,
        manual_resume_per_1000_chars: m.manual_resume_per_1000_chars,
        auto_metric_unreliable: m.auto_metric_unreliable,
        npc_subplot: npc.npc_subplot,
        external_dialogue_blocks: npc.external_dialogue_blocks,
        trailing_reaction_points: trailing ? 1 : 0,
        content_hash: m.content_hash,
      };
      samples.push(row);
      mdLines.push(
        `| ${r} | ${t} | ${m.canonical_length_ws} | ${m.raw_quote_blocks} | ${m.manual_semantic_units} | ${m.manual_resume_transitions} | ${m.manual_fragmentation_multiplier} | ${m.auto_metric_unreliable ? "AUTO_METRIC_UNRELIABLE" : "ok"} | ${npc.npc_subplot ? "yes" : "no"} |`
      );
    }
  }

  const manualResume = samples.map((s) => (s as { manual_resume_transitions: number }).manual_resume_transitions);
  const manualFrag = samples.map(
    (s) => (s as { manual_fragmentation_multiplier: number }).manual_fragmentation_multiplier
  );
  const manualUnits = samples.map((s) => (s as { manual_semantic_units: number }).manual_semantic_units);

  const summary = {
    generated_at: new Date().toISOString(),
    n: samples.length,
    manual_semantic_units_avg: Math.round((manualUnits.reduce((a, b) => a + b, 0) / manualUnits.length) * 100) / 100,
    manual_resume_avg: Math.round((manualResume.reduce((a, b) => a + b, 0) / manualResume.length) * 100) / 100,
    manual_resume_median: median(manualResume),
    manual_fragmentation_avg: Math.round((manualFrag.reduce((a, b) => a + b, 0) / manualFrag.length) * 100) / 100,
    manual_fragmentation_median: median(manualFrag),
    quote_blocks_per_1000_avg:
      Math.round(
        (samples.reduce(
          (a, s) => a + ((s as { raw_quote_blocks_per_1000_chars: number }).raw_quote_blocks_per_1000_chars ?? 0),
          0
        ) /
          samples.length) *
          100
      ) / 100,
    manual_resume_per_1000_avg:
      Math.round(
        (samples.reduce(
          (a, s) => a + ((s as { manual_resume_per_1000_chars: number }).manual_resume_per_1000_chars ?? 0),
          0
        ) /
          samples.length) *
          100
      ) / 100,
    npc_subplot_rate: `${samples.filter((s) => (s as { npc_subplot: boolean }).npc_subplot).length}/${samples.length}`,
    auto_metric_unreliable_count: samples.filter(
      (s) => (s as { auto_metric_unreliable?: boolean }).auto_metric_unreliable
    ).length,
    samples,
  };

  mkdirSync(ROOT, { recursive: true });
  writeFileSync(join(ROOT, "METRICS_V2.json"), JSON.stringify(summary, null, 2), "utf8");
  writeFileSync(join(ROOT, "MANUAL_REVIEW_V2.md"), mdLines.join("\n") + "\n", "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main();
