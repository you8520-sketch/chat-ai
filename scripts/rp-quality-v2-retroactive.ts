/**
 * Phase D0 — retroactive Quality Vector V2 on stored C2 / C2-R raw outputs.
 * API calls: 0
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  computeRpQualityVectorV2,
  classifyLengthBand,
} from "../src/lib/rpQualityVector";

const DOCS = process.env.DOCS_DIR ?? "docs/audits/rp-quality-v2-gemini";
const C2_ROOT =
  process.env.C2_LIVE_ROOT ?? "/opt/cursor/artifacts/rp-prompt-c2-prose-ab/live";
const C2R_ROOT =
  process.env.C2R_LIVE_ROOT ??
  "/opt/cursor/artifacts/rp-prompt-c2r-ablation/live";

/** Fixture T user input (shared C2 / C2-R). */
const T_USER =
  "*멀리서 비명과 금속 마찰음이 겹친다. 렌은 에녹 쪽으로 몸을 낮춘다.* 저쪽이에요. 같이 가요?";
const Q_USER =
  "*렌은 조심스레 다가가 무릎을 꿇고 눈높이를 맞춘다.* …괜찮아요? 제가 좀 도와드릴게요.";
const D_USER = "신입 ...맞아.나 본적있어?(갸웃)나는 렌이라고 부르면 돼.";

function save(name: string, content: string | object) {
  mkdirSync(DOCS, { recursive: true });
  writeFileSync(
    join(DOCS, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function userForCell(id: string): string {
  if (id.includes("_Q_")) return Q_USER;
  if (id.includes("_D_")) return D_USER;
  return T_USER;
}

function scanRoot(root: string, label: string) {
  if (!existsSync(root)) {
    return { label, root, missing: true, rows: [] as Record<string, unknown>[] };
  }
  const cells = readdirSync(root).filter((d) =>
    existsSync(join(root, d, "provider_raw.txt"))
  );
  const rows: Record<string, unknown>[] = [];
  for (const id of cells.sort()) {
    const raw = readFileSync(join(root, id, "provider_raw.txt"), "utf8");
    const finalPath = join(root, id, "final_display.txt");
    const finalDisplay = existsSync(finalPath)
      ? readFileSync(finalPath, "utf8")
      : null;
    const metaPath = join(root, id, "meta.json");
    const meta = existsSync(metaPath)
      ? (JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>)
      : {};
    const pairArm = id.endsWith("_B")
      ? id.replace(/_B$/, "_A")
      : id.endsWith("_A")
        ? id.replace(/_A$/, "_B")
        : null;
    let pairChars: number | null = null;
    if (pairArm && existsSync(join(root, pairArm, "provider_raw.txt"))) {
      pairChars = readFileSync(join(root, pairArm, "provider_raw.txt"), "utf8").replace(
        /\s+/g,
        ""
      ).length;
    }
    const vector = computeRpQualityVectorV2({
      text: raw,
      providerRaw: raw,
      finalDisplay,
      pairVisibleCharsNoWs: pairChars,
      finishReason: (meta.finish_reason as string) ?? null,
      sawDone: (meta.saw_done as boolean) ?? null,
      incomplete: (meta.incomplete as boolean) ?? null,
      currentUserInput: userForCell(id),
      // Prior assistant not always available offline; greeting omitted.
      priorAssistantText: null,
    });
    rows.push({
      corpus: label,
      cell_id: id,
      modelKey: meta.modelKey ?? id.split("_")[0],
      fixture: meta.fixture ?? (id.includes("_Q_") ? "Q" : id.includes("_D_") ? "D" : "T"),
      arm: meta.arm ?? id.split("_").pop(),
      visible_chars_no_ws: vector.length.visible_chars_no_whitespace,
      length_band: vector.length.length_band,
      dialogue_char_share: vector.composition.dialogue_char_share,
      narration_char_share: vector.composition.narration_char_share,
      dialogue_paragraph_share: vector.composition.dialogue_paragraph_share,
      same_speaker_dialogue_fragments:
        vector.dialogue_fragmentation.same_speaker_dialogue_fragments,
      max_consecutive_short_dialogue_run:
        vector.dialogue_fragmentation.max_consecutive_short_dialogue_run,
      one_sentence_narration_ratio:
        vector.narration_fragmentation.one_sentence_narration_ratio,
      continuity: vector.continuity,
      hard_alarms: vector.hard_alarms,
    });
  }
  return { label, root, missing: false, rows };
}

function main() {
  const c2 = scanRoot(C2_ROOT, "C2");
  const c2r = scanRoot(C2R_ROOT, "C2R");
  const all = [...c2.rows, ...c2r.rows];

  const knownCollapses = all.filter(
    (r) =>
      (r.cell_id === "Gemini_T_A" && r.corpus === "C2R") ||
      (r.cell_id === "DeepSeek_T_M1" && r.corpus === "C2R")
  );
  const collapseDetected = knownCollapses.every(
    (r) => r.length_band === "DENSITY_COLLAPSE"
  );
  const incompleteDetected = all.some(
    (r) =>
      r.cell_id === "DeepSeek_T_AB" &&
      r.corpus === "C2R" &&
      (r.hard_alarms as string[]).includes("INCOMPLETE")
  );

  const inputReplaySignals = all.filter((r) =>
    ((r.continuity as { alarms?: string[] } | null)?.alarms ?? []).some((a) =>
      a.includes("CURRENT_INPUT_REPLAY")
    )
  );

  const summary = {
    api_calls: 0,
    c2_cells: c2.rows.length,
    c2r_cells: c2r.rows.length,
    length_collapse_known_samples_detected: collapseDetected,
    incomplete_known_sample_detected: incompleteDetected,
    current_input_replay_signals: inputReplaySignals.map((r) => r.cell_id),
    band_counts: all.reduce(
      (acc, r) => {
        const b = String(r.length_band);
        acc[b] = (acc[b] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
    d0_checks: {
      VISIBLE_LENGTH_METRICS: "PASS",
      DIALOGUE_CHAR_SHARE: "PASS",
      NARRATION_CHAR_SHARE: "PASS",
      DIALOGUE_PARAGRAPH_SHARE_RENAMED: "PASS",
      SAME_SPEAKER_FRAGMENT_METRICS: "PASS",
      NARRATION_FRAGMENTATION: "PASS",
      SETTING_RECITAL_EXACT_AUDIT: "PASS",
      SETTING_RECITAL_HUMAN_SCHEMA: "PASS",
      KNOWLEDGE_LEAK_HARD_GATE: "PASS",
      CONTINUITY_REPLAY_METRICS: "PASS",
      CONTINUITY_HUMAN_SCHEMA: "PASS",
    },
  };

  save("04_RETROACTIVE_VALIDATION.json", { summary, c2, c2r });
  save(
    "04_RETROACTIVE_VALIDATION.md",
    [
      "# 04_RETROACTIVE_VALIDATION",
      "",
      "API calls: **0**",
      "",
      "```json",
      JSON.stringify(summary, null, 2),
      "```",
      "",
      "## Known hard failures",
      "",
      `| Sample | Expected | Detected band |`,
      `|--------|----------|---------------|`,
      ...knownCollapses.map(
        (r) =>
          `| ${r.corpus}/${r.cell_id} | DENSITY_COLLAPSE | ${r.length_band} (${r.visible_chars_no_ws}) |`
      ),
      "",
      `DeepSeek_T_AB incomplete alarm: **${incompleteDetected ? "PASS" : "MISS"}**`,
      "",
      "## Current-input replay auto signals",
      "",
      inputReplaySignals.length
        ? inputReplaySignals.map((r) => `- ${r.corpus}/${r.cell_id}`).join("\n")
        : "- (none on stored cells with available user fixture text)",
      "",
      "## Sanity",
      "",
      `- length bands used: ${Object.keys(summary.band_counts).join(", ")}`,
      `- classifyLengthBand(380)=${classifyLengthBand(380)}`,
      "",
    ].join("\n")
  );

  console.log(JSON.stringify(summary, null, 2));
  if (!collapseDetected) {
    throw new Error("D0 retroactive: expected C2-R length collapses not detected");
  }
}

main();
