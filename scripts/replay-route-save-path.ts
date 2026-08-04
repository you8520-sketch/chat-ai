/**
 * Offline route-save-path replay — runs a captured provider RAW fixture through
 * the ACTUAL route save pipeline (no model calls, no DB, no SSE) to pinpoint
 * where paragraph count inflates.
 *
 * Mirrors src/app/api/chat/route.ts non-oocHtmlMode save path:
 *   S0 raw_stream           = fixture (rawStreamText)
 *   S1 live_stream_visible  = liveStreamProse(raw) — what client sees during stream
 *   S2 after_status_partition = partitionModelStatusArtifacts(raw).prose
 *   S3 after_stream_first   = applyStreamFirstAfterStatusPartition
 *   S4 after_strip_emotion  = stripEmotionTagsForDisplay
 *   S5 after_preserve_stream = preserveStreamFirstProse (initial savedText)
 *   S6 after_sentence_recovery = recoverSentenceCompletionInFullResponse
 *   S7 after_strip_broken_html = stripBrokenHtmlFragmentAtEnd
 *   S8 after_strip_trailing_quotes = stripRepeatedTrailingQuoteMarks
 *   S9 savedText_final
 *
 * Then client-side display stages on savedText_final:
 *   C1 noveltext_input = savedText_final
 *   C2 group_novel_paragraphs (array)
 *   C3 dom_paragraphs (resolveNovelDisplayParagraphs array)
 *
 * Usage:
 *   node --import tsx scripts/replay-route-save-path.ts <raw-fixture.txt>
 *   node --import tsx scripts/replay-route-save-path.ts --all
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { computeDialogueMetrics, estimateManualSemanticMetrics } from "../src/lib/dialogueMetrics";
import { sanitizeStreamArtifacts, clampResponseLength } from "../src/lib/responseLength";
import { stripEmotionTagsForDisplay, stripTrailingEmotionTagStreamCandidate } from "../src/lib/emotionTag";
import { stripInternalTagLeakage, stripRpMetaLeakage } from "../src/lib/narrativeRules";
import {
  partitionModelStatusArtifacts,
  stripAllStatusWindowOutputArtifacts,
} from "../src/lib/statusMeta/stripArtifacts";
import { stripLeakedDocumentMarkup } from "../src/lib/chatHtmlSanitize";
import {
  preserveStreamFirstProse,
  applyStreamFirstAfterStatusPartition,
} from "../src/lib/streamFirstSave";
import { recoverSentenceCompletionInFullResponse } from "../src/lib/sentenceCompletionRecovery";
import { stripBrokenHtmlFragmentAtEnd } from "../src/lib/htmlTailStrip";
import { stripRepeatedTrailingQuoteMarks } from "../src/lib/trailingQuoteSanitizer";
import {
  groupNovelParagraphs,
  resolveNovelDisplayParagraphs,
} from "../src/lib/novelParagraphs";

const ART_ROOT = "/opt/cursor/artifacts/deepseek-common-root-audit";
const OUT_DIR = join(ART_ROOT, "00-integrity", "stage-replay");

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Replicate openRouterAdult.liveStreamProse (private). */
function liveStreamProse(raw: string): string {
  const sanitized = stripInternalTagLeakage(
    stripTrailingEmotionTagStreamCandidate(sanitizeStreamArtifacts(raw))
  );
  const prose = stripAllStatusWindowOutputArtifacts(sanitized);
  return stripLeakedDocumentMarkup(prose);
}

function metrics(text: string, arrayLen?: number) {
  const m = computeDialogueMetrics({ text });
  const manual = estimateManualSemanticMetrics(text);
  return {
    char_len: text.length,
    hash: sha256(text),
    paragraph_count: arrayLen ?? m.paragraph_count,
    quote_pair_count: m.raw_quote_blocks,
    manual_semantic_units: manual.manual_semantic_units,
    manual_resume_transitions: manual.manual_resume_transitions,
    blank_line_count: (text.match(/\n\s*\n/g) ?? []).length,
    newline_count: (text.match(/\n/g) ?? []).length,
  };
}

function replayRouteSave(label: string, raw: string) {
  const S0 = raw;
  const S1 = liveStreamProse(S0);
  const preStatusPartition = S0;
  const statusArtifacts = partitionModelStatusArtifacts(S0);
  const S2 = statusArtifacts.prose;
  const S3 = applyStreamFirstAfterStatusPartition({
    streamVisible: S1,
    prePartitionText: preStatusPartition,
    proseAfterPartition: S2,
    targetResponseChars: null,
  });
  let saved = stripEmotionTagsForDisplay(S3);
  const S4 = saved;
  saved = preserveStreamFirstProse(S1, saved, null);
  const S5 = saved;
  const recovery = recoverSentenceCompletionInFullResponse(saved);
  saved = recovery.text;
  const S6 = saved;
  const htmlStrip = stripBrokenHtmlFragmentAtEnd(saved);
  saved = htmlStrip.text;
  const S7 = saved;
  saved = stripRepeatedTrailingQuoteMarks(saved);
  const S8 = saved;
  const S9 = saved;

  // Client display on final savedText
  const C1 = S9;
  const C2 = groupNovelParagraphs(C1);
  const C3 = resolveNovelDisplayParagraphs(C1);

  const stages = {
    S0_raw_stream: metrics(S0),
    S1_live_stream_visible: metrics(S1),
    S2_after_status_partition: metrics(S2),
    S3_after_stream_first: metrics(S3),
    S4_after_strip_emotion: metrics(S4),
    S5_after_preserve_stream: metrics(S5),
    S6_after_sentence_recovery: metrics(S6),
    S7_after_strip_broken_html: metrics(S7),
    S8_after_strip_trailing_quotes: metrics(S8),
    S9_savedText_final: metrics(S9),
    C1_noveltext_input: metrics(C1),
    C2_group_novel_paragraphs: { ...metrics(C2.join("\n\n")), paragraph_count: C2.length, array_len: C2.length },
    C3_dom_paragraphs: { ...metrics(C3.join("\n\n")), paragraph_count: C3.length, array_len: C3.length },
  };

  const order = Object.keys(stages) as (keyof typeof stages)[];
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

function loadFixture(path: string) {
  const raw = readFileSync(path, "utf8");
  const label = path.replace(ART_ROOT + "/", "").replace(/\//g, "__").replace(/\.txt$/, "");
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
    const p = join(ART_ROOT, "01-postprocess", "ds_pipeline_baseline", "run1", "turn1-provider-raw.txt");
    if (existsSync(p)) fixtures.push(loadFixture(p));
  }
  if (fixtures.length === 0) {
    console.error("No fixtures found.");
    process.exit(1);
  }
  const results = fixtures.map((f) => replayRouteSave(f.label, f.raw));
  for (const r of results) {
    const s0 = r.stages.S0_raw_stream.paragraph_count;
    const s9 = r.stages.S9_savedText_final.paragraph_count;
    const c3 = r.stages.C3_dom_paragraphs.paragraph_count;
    console.log(
      `${r.label}: S0_raw=${s0} -> S9_savedText=${s9} -> C3_dom=${c3} | inflation: ${
        r.inflation_steps.map((s) => `${s.from}→${s.to}(+${s.delta})`).join(", ") || "none"
      }`
    );
  }
  writeFileSync(
    join(OUT_DIR, "route-save-replay.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2),
    "utf8"
  );
  console.log(`\nWrote ${join(OUT_DIR, "route-save-replay.json")}`);
}

main();
