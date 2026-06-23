/**
 * Structural density audit — measurement only (no prompt patches).
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-structural-density.ts
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const TURNS = [2, 5, 8] as const;
const MODELS = [
  "google/gemini-2.5-pro",
  "qwen/qwen3.7-max",
  "deepseek/deepseek-v4-pro",
] as const;

const USER_MSG =
  "밤이 깊었어. 무서워서 손 잡아줄래? …다 알아요, 내 몸이 원하는 거 알아? 천천히 해줘.";

const PAUSE_STOP_PATTERN =
  /(?:기다리|반응을 기다|대답을 기다|말을 기다|선택을 기다|확인하며|지켜보|바라보|응시하며|호흡.*(?:들|확인)|침묵|정적|고요|망설|가늠|멈추|멈췄|잠시|일시)/;

type CharBucket = "under_700" | "700_1200" | "over_1200";

type StructuralMetrics = {
  narration_paragraph_count: number;
  avg_sentences_per_narration_paragraph: number;
  narration_paragraph_sentence_counts: number[];
  dialogue_block_count: number;
  avg_dialogue_length_chars: number;
  dialogue_lengths_chars: number[];
  narration_char_count: number;
  dialogue_char_count: number;
  narration_to_dialogue_char_ratio: number;
  chars_before_first_dialogue: number;
  chars_before_first_pause_marker: number;
  first_stopping_opportunity_char: number;
  first_stopping_opportunity_type: string;
  total_paragraphs: number;
};

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…]["']?)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function analyzeStructuralDensity(text: string): StructuralMetrics {
  const trimmed = text.trim();
  const paragraphs = trimmed.split(/\n\n+/).filter((p) => p.trim());

  const narrationParagraphs = paragraphs.filter((p) => {
    const withoutQuotes = p.replace(/"[^"]*"/g, "").trim();
    return withoutQuotes.length > 8;
  });

  const narrParaSentenceCounts: number[] = [];
  for (const p of narrationParagraphs) {
    const withoutQuotes = p.replace(/"[^"]*"/g, " ").trim();
    const sents = splitSentences(withoutQuotes).filter((s) => s.length > 4);
    narrParaSentenceCounts.push(sents.length > 0 ? sents.length : 1);
  }

  const dialogueMatches = [...trimmed.matchAll(/"([^"]*)"/g)];
  const dialogueBlocks = dialogueMatches.map((m) => m[1]);
  const dialogueLengths = dialogueBlocks.map((d) => d.length);

  const narrationCharCount = trimmed.replace(/"[^"]*"/g, "").replace(/\s+/g, " ").trim().length;
  const dialogueCharCount = dialogueLengths.reduce((a, b) => a + b, 0);
  const ratio =
    dialogueCharCount > 0 ? narrationCharCount / dialogueCharCount : narrationCharCount;

  const firstDialogueIdx = trimmed.search(/"/);
  const charsBeforeFirstDialogue = firstDialogueIdx >= 0 ? firstDialogueIdx : trimmed.length;

  let charsBeforeFirstPause = trimmed.length;
  let firstStopChar = trimmed.length;
  let firstStopType = "end_of_response";

  const flat = trimmed.replace(/\n+/g, " ");
  const sentences = splitSentences(flat);
  let pos = 0;
  for (const sent of sentences) {
    const sentStart = flat.indexOf(sent, pos);
    const sentEnd = sentStart + sent.length;
    pos = sentEnd;

    if (charsBeforeFirstPause === trimmed.length && PAUSE_STOP_PATTERN.test(sent)) {
      charsBeforeFirstPause = sentEnd;
    }

    if (firstStopChar === trimmed.length) {
      if (PAUSE_STOP_PATTERN.test(sent)) {
        firstStopChar = sentEnd;
        firstStopType = "pause_observer_marker";
      } else if (/^"[^"]*"$/.test(sent.trim())) {
        firstStopChar = sentEnd;
        firstStopType = "after_dialogue_line";
      }
    }
  }

  if (firstDialogueIdx >= 0) {
    const m = trimmed.slice(firstDialogueIdx).match(/^"[^"]*"/);
    if (m) {
      const afterFirstDialogue = firstDialogueIdx + m[0].length;
      if (afterFirstDialogue < firstStopChar) {
        firstStopChar = afterFirstDialogue;
        firstStopType = "after_first_dialogue";
      }
    }
  }

  const avgSentPerNarr =
    narrParaSentenceCounts.length > 0
      ? narrParaSentenceCounts.reduce((a, b) => a + b, 0) / narrParaSentenceCounts.length
      : 0;

  const avgDialogueLen =
    dialogueLengths.length > 0
      ? dialogueLengths.reduce((a, b) => a + b, 0) / dialogueLengths.length
      : 0;

  return {
    narration_paragraph_count: narrationParagraphs.length,
    avg_sentences_per_narration_paragraph: avgSentPerNarr,
    narration_paragraph_sentence_counts: narrParaSentenceCounts,
    dialogue_block_count: dialogueBlocks.length,
    avg_dialogue_length_chars: avgDialogueLen,
    dialogue_lengths_chars: dialogueLengths,
    narration_char_count: narrationCharCount,
    dialogue_char_count: dialogueCharCount,
    narration_to_dialogue_char_ratio: ratio,
    chars_before_first_dialogue: charsBeforeFirstDialogue,
    chars_before_first_pause_marker: charsBeforeFirstPause,
    first_stopping_opportunity_char: firstStopChar,
    first_stopping_opportunity_type: firstStopType,
    total_paragraphs: paragraphs.length,
  };
}

function charBucket(chars: number): CharBucket {
  if (chars < 700) return "under_700";
  if (chars <= 1200) return "700_1200";
  return "over_1200";
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i] - mx;
    const y = ys[i] - my;
    num += x * y;
    dx += x * x;
    dy += y * y;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

type DensityLog = {
  model_id: string;
  turn_number: number;
  finish_reason: string | null;
  response_char_count: number;
  char_bucket: CharBucket;
  structural: StructuralMetrics;
  timestamp: string;
};

async function fixture(t: number) {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const charName = "백하율";
  const persona = "렌";
  const chunks = parseCharacterSetting({
    characterId: "mock-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며.`,
    world: `# 세계관\n현대.`,
    exampleDialog: `유저: hi\n${charName}: …`,
    statusWindowPrompt: "",
  });
  return {
    charName,
    personaDisplayName: persona,
    chunks,
    userPersonaPrompt: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNotePrompt: formatUserNoteForPrompt(""),
    longTermMemory: "",
    memoryMeta: formatMemoryMetaForPrompt(
      parseMemoryMeta(JSON.stringify({ affection: 40, trust: 35 }))
    ),
    shortTermHistory: [] as { role: "user" | "assistant"; content: string }[],
    currentUserMessage: USER_MSG,
    nsfw: true,
    gender: "male" as const,
    userPersonaGender: "other" as const,
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 2500,
    completedTurns: t,
    genres: ["공포/추리"] as import("../src/lib/characterGenres").CharacterGenre[],
  };
}

function buildReport(rows: DensityLog[]): string {
  const chars = rows.map((r) => r.response_char_count);
  const lines: string[] = [
    "=".repeat(72),
    "STRUCTURAL DENSITY AUDIT REPORT",
    `generated: ${new Date().toISOString()}`,
    `samples: ${rows.length}`,
    "=".repeat(72),
    "",
  ];

  const buckets: CharBucket[] = ["under_700", "700_1200", "over_1200"];
  const bucketLabels: Record<CharBucket, string> = {
    under_700: "<700 chars",
    "700_1200": "700–1200 chars",
    over_1200: ">1200 chars",
  };

  lines.push("## Per-response summary");
  lines.push("");
  for (const r of rows) {
    const s = r.structural;
    lines.push(
      `${r.model_id.split("/").pop()} t=${r.turn_number} | ${r.response_char_count} chars [${r.char_bucket}]`
    );
    lines.push(
      `  narr_paras=${s.narration_paragraph_count} avg_sent/para=${s.avg_sentences_per_narration_paragraph.toFixed(1)} dialogue=${s.dialogue_block_count} avg_dlg_len=${s.avg_dialogue_length_chars.toFixed(0)} ratio_n/d=${s.narration_to_dialogue_char_ratio.toFixed(1)}`
    );
    lines.push(
      `  first_stop_opp=${s.first_stopping_opportunity_char} (${s.first_stopping_opportunity_type}) pause_at=${s.chars_before_first_pause_marker}`
    );
  }
  lines.push("");

  lines.push("## Char-bucket aggregates");
  lines.push("");
  lines.push(
    "| Bucket | n | avg chars | narr paras | avg sent/para | dialogue blocks | avg dlg len | n/d ratio | first stop opp |"
  );
  lines.push("|--------|---|-----------|------------|---------------|-----------------|-------------|-----------|----------------|");

  for (const b of buckets) {
    const subset = rows.filter((r) => r.char_bucket === b);
    if (!subset.length) {
      lines.push(`| ${bucketLabels[b]} | 0 | — | — | — | — | — | — | — |`);
      continue;
    }
    lines.push(
      `| ${bucketLabels[b]} | ${subset.length} | ${avg(subset.map((r) => r.response_char_count)).toFixed(0)} | ${avg(subset.map((r) => r.structural.narration_paragraph_count)).toFixed(1)} | ${avg(subset.map((r) => r.structural.avg_sentences_per_narration_paragraph)).toFixed(1)} | ${avg(subset.map((r) => r.structural.dialogue_block_count)).toFixed(1)} | ${avg(subset.map((r) => r.structural.avg_dialogue_length_chars)).toFixed(0)} | ${avg(subset.map((r) => r.structural.narration_to_dialogue_char_ratio)).toFixed(1)} | ${avg(subset.map((r) => r.structural.first_stopping_opportunity_char)).toFixed(0)} |`
    );
  }
  lines.push("");

  const corrKeys: Array<{ key: string; get: (r: DensityLog) => number }> = [
    { key: "narration_paragraph_count", get: (r) => r.structural.narration_paragraph_count },
    { key: "avg_sentences_per_narration_paragraph", get: (r) => r.structural.avg_sentences_per_narration_paragraph },
    { key: "dialogue_block_count", get: (r) => r.structural.dialogue_block_count },
    { key: "avg_dialogue_length_chars", get: (r) => r.structural.avg_dialogue_length_chars },
    { key: "narration_to_dialogue_char_ratio", get: (r) => r.structural.narration_to_dialogue_char_ratio },
    { key: "total_paragraphs", get: (r) => r.structural.total_paragraphs },
    { key: "first_stopping_opportunity_char", get: (r) => r.structural.first_stopping_opportunity_char },
    { key: "chars_before_first_pause_marker", get: (r) => r.structural.chars_before_first_pause_marker },
  ];

  lines.push("## Correlation with response_char_count (Pearson r)");
  lines.push("");
  const ranked = corrKeys
    .map((c) => ({ key: c.key, r: pearson(chars, rows.map(c.get)) }))
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

  for (const { key, r } of ranked) {
    lines.push(`  ${key}: ${r.toFixed(3)}`);
  }
  lines.push(`  → strongest correlate: ${ranked[0]?.key} (r=${ranked[0]?.r.toFixed(3)})`);
  lines.push("");

  lines.push("## Research questions");
  lines.push("");

  const under = rows.filter((r) => r.char_bucket === "under_700");
  const mid = rows.filter((r) => r.char_bucket === "700_1200");
  const over = rows.filter((r) => r.char_bucket === "over_1200");

  const narrParaUnder = avg(under.map((r) => r.structural.narration_paragraph_count));
  const narrParaOver = avg(over.map((r) => r.structural.narration_paragraph_count));
  lines.push(
    `A. More narrative paragraphs in longer responses? ${narrParaOver > narrParaUnder ? "YES" : narrParaOver < narrParaUnder ? "NO" : "MIXED"} — under_700 avg ${narrParaUnder.toFixed(1)} paras vs over_1200 avg ${narrParaOver.toFixed(1)} paras`
  );

  const densUnder = avg(under.map((r) => r.structural.avg_sentences_per_narration_paragraph));
  const densOver = avg(over.map((r) => r.structural.avg_sentences_per_narration_paragraph));
  lines.push(
    `B. Denser paragraphs in longer responses? ${densOver > densUnder ? "YES (more sent/para)" : densOver < densUnder ? "NO (fewer sent/para)" : "MIXED"} — under_700 avg ${densUnder.toFixed(1)} sent/para vs over_1200 ${densOver.toFixed(1)} sent/para`
  );

  const stopUnder = avg(under.map((r) => r.structural.first_stopping_opportunity_char));
  const stopOver = avg(over.map((r) => r.structural.first_stopping_opportunity_char));
  const stopPctUnder = under.length ? avg(under.map((r) => r.structural.first_stopping_opportunity_char / r.response_char_count)) : 0;
  const stopPctOver = over.length ? avg(over.map((r) => r.structural.first_stopping_opportunity_char / r.response_char_count)) : 0;
  lines.push(
    `C. Longer responses delay first stopping opportunity? ${stopOver > stopUnder ? "YES (later absolute char)" : "NO"} — first_stop under_700 avg ${stopUnder.toFixed(0)} chars (${(stopPctUnder * 100).toFixed(0)}% of length) vs over_1200 ${stopOver.toFixed(0)} chars (${(stopPctOver * 100).toFixed(0)}% of length)`
  );

  const shortEx = rows.filter((r) => r.response_char_count < 650).sort((a, b) => a.response_char_count - b.response_char_count)[0];
  const longEx = rows.filter((r) => r.response_char_count > 1400).sort((a, b) => b.response_char_count - a.response_char_count)[0];

  lines.push("D. Structural difference ~600 vs ~1500 char responses:");
  if (shortEx && longEx) {
    lines.push(`  SHORT: ${shortEx.model_id.split("/").pop()} t=${shortEx.turn_number} ${shortEx.response_char_count} chars`);
    lines.push(`    narr_paras=${shortEx.structural.narration_paragraph_count} sent/para=${shortEx.structural.avg_sentences_per_narration_paragraph.toFixed(1)} dialogue=${shortEx.structural.dialogue_block_count} ratio=${shortEx.structural.narration_to_dialogue_char_ratio.toFixed(1)}`);
    lines.push(`  LONG:  ${longEx.model_id.split("/").pop()} t=${longEx.turn_number} ${longEx.response_char_count} chars`);
    lines.push(`    narr_paras=${longEx.structural.narration_paragraph_count} sent/para=${longEx.structural.avg_sentences_per_narration_paragraph.toFixed(1)} dialogue=${longEx.structural.dialogue_block_count} ratio=${longEx.structural.narration_to_dialogue_char_ratio.toFixed(1)}`);
    lines.push(
      `  Delta: +${longEx.structural.narration_paragraph_count - shortEx.structural.narration_paragraph_count} narr paras, +${(longEx.structural.avg_sentences_per_narration_paragraph - shortEx.structural.avg_sentences_per_narration_paragraph).toFixed(1)} sent/para, +${longEx.structural.dialogue_block_count - shortEx.structural.dialogue_block_count} dialogue blocks`
    );
  } else {
    lines.push("  (no samples in both extremes in this run)");
  }
  lines.push("");

  lines.push("## Conclusion");
  const top = ranked[0];
  if (top && Math.abs(top.r) >= 0.5) {
    lines.push(
      `Primary structural driver of length in this cohort: ${top.key} (r=${top.r.toFixed(3)}).`
    );
  } else {
    lines.push("No single structural feature shows strong correlation (|r|<0.5); length variance may be model/stochastic.");
  }

  return lines.join("\n");
}

async function main() {
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(outDir, `structural-density-audit-${stamp}.jsonl`);
  const reportPath = path.join(outDir, `structural-density-audit-${stamp}.txt`);

  const rows: DensityLog[] = [];

  console.log("=== Structural density audit ===");
  console.log("Models:", MODELS.join(", "));
  console.log("Log:", logPath);

  for (const model_id of MODELS) {
    for (const turn_number of TURNS) {
      const f = await fixture(turn_number);
      const built = buildContext({
        ...f,
        userNickname: f.personaDisplayName,
        assetTags: undefined,
        modelId: model_id,
        provider: "openrouter",
      });

      console.log(`→ ${model_id} t=${turn_number} …`);
      const result = await callOpenRouterAdult(
        built.systemPrompt,
        [{ role: "user", content: f.currentUserMessage }],
        model_id,
        f.targetResponseChars,
        { charName: f.charName },
        { chargeTurnBudget: false, requestKind: "structural-density-audit" }
      );

      const text = result.text.trim();
      const response_char_count = visibleAssistantDisplayCharCount(text);
      const structural = analyzeStructuralDensity(text);

      const row: DensityLog = {
        model_id,
        turn_number,
        finish_reason: result.usage.finishReason ?? null,
        response_char_count,
        char_bucket: charBucket(response_char_count),
        structural,
        timestamp: new Date().toISOString(),
      };

      rows.push(row);
      fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
      console.log({
        model_id,
        turn_number,
        response_char_count,
        char_bucket: row.char_bucket,
        narr_paras: structural.narration_paragraph_count,
        avg_sent_per_para: structural.avg_sentences_per_narration_paragraph.toFixed(1),
        dialogue_blocks: structural.dialogue_block_count,
        first_stop: structural.first_stopping_opportunity_char,
      });
    }
  }

  const report = buildReport(rows);
  fs.writeFileSync(reportPath, report, "utf8");
  console.log("\n" + report);
  console.log(`\nReport: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
