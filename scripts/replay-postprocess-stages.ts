/**
 * Offline stage replay — runs a captured provider RAW fixture through the
 * full server + client postprocess pipeline WITHOUT any model calls.
 *
 * Captures stages A→L:
 *   A provider_raw_merged          (fixture input)
 *   D sanitize (strip/status/meta)
 *   E pre_display (normalizeAiNovelProsePreDisplay)
 *   F post_display (applyDisplayParagraphGrouping = savedText)
 *   G sse_final (serialized = savedText)
 *   L db_saved (= savedText)
 *   I noveltext_input (= savedText)
 *   J group_novel_paragraphs (groupNovelParagraphs array)
 *   K dom_paragraphs (resolveNovelDisplayParagraphs array)
 *
 * For each stage records: char_len, hash, no_newline_hash, newline_count,
 * blank_line_count, paragraph_count, quote_pair_count, manual_semantic_units,
 * manual_resume_transitions.
 *
 * Usage:
 *   node --import tsx scripts/replay-postprocess-stages.ts <raw-fixture.txt>
 *   node --import tsx scripts/replay-postprocess-stages.ts --all
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, from } from "node:path";
import { createHash } from "node:crypto";
import {
  computeDialogueMetrics,
  extractQuoteBlocks,
  estimateManualSemanticMetrics,
} from "../src/lib/dialogueMetrics";
import {
  normalizeAiNovelProsePreDisplay,
  applyDisplayParagraphGrouping,
  groupNovelParagraphs,
  resolveNovelDisplayParagraphs,
} from "../src/lib/novelParagraphs";
import { sanitizeStreamArtifacts } from "../src/lib/responseLength";

const ART_ROOT = "/opt/cursor/artifacts/deepseek-common-root-audit";
const OUT_DIR = join(ART_ROOT, "00-integrity", "stage-replay");

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function stageMetrics(text: string, arrayForm = false) {
  const metrics = computeDialogueMetrics({ text });
  const manual = estimateManualSemanticMetrics(text);
  const newlineCount = (text.match(/\n/g) ?? []).length;
  const blankLineCount = (text.match(/\n\s*\n/g) ?? []).length;
  const paragraphCount = arrayForm
    ? (text as unknown as string[]).length
    : metrics.paragraph_count;
  return {
    char_len: text.length,
    hash: sha256(text),
    no_newline_hash: sha256(text.replace(/[\r\n\u00a0]+/g, " ")),
    newline_count: newlineCount,
    blank_line_count: blankLineCount,
    paragraph_count: paragraphCount,
    quote_pair_count: metrics.raw_quote_blocks,
    manual_semantic_units: manual.manual_semantic_units,
    manual_resume_transitions: manual.manual_resume_transitions,
  };
}

function replayFixture(label: string, raw: string) {
  const A = raw;
  const D = sanitizeStreamArtifacts(A);
  const E = normalizeAiNovelProsePreDisplay(D);
  const F = applyDisplayParagraphGrouping(E);
  const G = F; // SSE serialized = savedText
  const L = F; // db_saved = savedText
  const I = F; // NovelText content prop
  const J = groupNovelParagraphs(I); // array
  const K = resolveNovelDisplayParagraphs(I); // DOM array

  const stages = {
    A_provider_raw: stageMetrics(A),
    D_sanitize: stageMetrics(D),
    E_pre_display: stageMetrics(E),
    F_post_display: stageMetrics(F),
    G_sse_final: stageMetrics(G),
    L_db_saved: stageMetrics(L),
    I_noveltext_input: stageMetrics(I),
    J_group_novel_paragraphs: { ...stageMetrics(J.join("\n\n")), paragraph_count: J.length, is_array: true, array_len: J.length },
    K_dom_paragraphs: { ...stageMetrics(K.join("\n\n")), paragraph_count: K.length, is_array: true, array_len: K.length },
  };

  // Find first stage where paragraph_count jumps vs previous stage.
  const order: (keyof typeof stages)[] = [
    "A_provider_raw",
    "D_sanitize",
    "E_pre_display",
    "F_post_display",
    "G_sse_final",
    "L_db_saved",
    "I_noveltext_input",
    "J_group_novel_paragraphs",
    "K_dom_paragraphs",
  ];
  const inflationSteps: { from: string; to: string; delta: number }[] = [];
  for (let i = 1; i < order.length; i++) {
    const prev = stages[order[i - 1]!];
    const cur = stages[order[i]!];
    const delta = cur.paragraph_count - prev.paragraph_count;
    if (Math.abs(delta) >= 2) {
      inflationSteps.push({ from: order[i - 1]!, to: order[i]!, delta });
    }
  }

  return { label, stages, inflation_steps: inflationSteps };
}

function loadFixture(path: string): { label: string; raw: string } {
  const raw = readFileSync(path, "utf8");
  const label = path
    .replace(/\.txt$/, "")
    .replace(ART_ROOT + "/", "")
    .replace(/\//g, "__");
  return { label, raw };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const arg = process.argv[2];
  const fixtures: { label: string; raw: string }[] = [];

  if (arg === "--all") {
    const base = join(ART_ROOT, "01-postprocess", "ds_pipeline_baseline");
    if (existsSync(base)) {
      for (const run of readdirSync(base).filter((d) => d.startsWith("run"))) {
        for (let t = 1; t <= 2; t++) {
          const p = join(base, run, `turn${t}-provider-raw.txt`);
          if (existsSync(p)) fixtures.push(loadFixture(p));
        }
      }
    }
  } else if (arg && existsSync(arg)) {
    fixtures.push(loadFixture(arg));
  } else {
    // default: P0 run1 turn1
    const p = join(ART_ROOT, "01-postprocess", "ds_pipeline_baseline", "run1", "turn1-provider-raw.txt");
    if (existsSync(p)) fixtures.push(loadFixture(p));
  }

  if (fixtures.length === 0) {
    console.error("No fixtures found. Provide a raw txt path or use --all.");
    process.exit(1);
  }

  const results = fixtures.map((f) => replayFixture(f.label, f.raw));

  // Print compact per-fixture inflation summary
  for (const r of results) {
    const a = r.stages.A_provider_raw.paragraph_count;
    const k = r.stages.K_dom_paragraphs.paragraph_count;
    const f = r.stages.F_post_display.paragraph_count;
    console.log(
      `${r.label}: RAW=${a} -> F_post_display=${f} -> K_dom=${k} | inflation steps: ${
        r.inflation_steps.map((s) => `${s.from}→${s.to}(+${s.delta})`).join(", ") || "none"
      }`
    );
  }

  writeFileSync(
    join(OUT_DIR, "stage-replay.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2),
    "utf8"
  );
  console.log(`\nWrote ${join(OUT_DIR, "stage-replay.json")}`);
}

main();
