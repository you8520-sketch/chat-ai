/**
 * Phase D3 — human seal + PHASE_D3_STATUS (API=0).
 * Scores from full RAW reads under docs/audits/rp-quality-v2-gemini/d3/raw/.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  estimateGeminiSceneContinuityTokens,
  GEMINI_SCENE_CONTINUITY_BLOCK,
} from "../src/lib/geminiSceneContinuityAdapter";

const DOCS = join("docs/audits/rp-quality-v2-gemini", "d3");

type Scores = {
  CURRENT_INPUT_REPLAY: number;
  INTRO_REPLAY: number;
  SETTING_RECITAL: number;
  ACTIVE_CANON_USE: number;
  CHARACTER_FIDELITY: number;
  SCENE_ADVANCEMENT: number;
  NEW_SCENE_VALUE: "LOW" | "MEDIUM" | "HIGH";
  OPENING_REPLAY_PARAGRAPHS: number;
  REPLAY_SAVED_CHARS_REPLACED_BY_NEW_SCENE: "YES" | "PARTIAL" | "NO" | "N/A";
  SCENE_FULLY_DEVELOPED: "YES" | "NO";
  COMPLETION: "PASS" | "FAIL";
  notes: string;
};

const HUMAN: Record<string, Scores> = {
  Gemini_G6T1_A: {
    CURRENT_INPUT_REPLAY: 3,
    INTRO_REPLAY: 0,
    SETTING_RECITAL: 1,
    ACTIVE_CANON_USE: 4,
    CHARACTER_FIDELITY: 4,
    SCENE_ADVANCEMENT: 2,
    NEW_SCENE_VALUE: "MEDIUM",
    OPENING_REPLAY_PARAGRAPHS: 2,
    REPLAY_SAVED_CHARS_REPLACED_BY_NEW_SCENE: "N/A",
    SCENE_FULLY_DEVELOPED: "YES",
    COMPLETION: "PASS",
    notes:
      "2130: opening restages scream/metal/fog before NPC judgment; later advances (refuse + relocate)",
  },
  Gemini_G6T1_C: {
    CURRENT_INPUT_REPLAY: 1,
    INTRO_REPLAY: 0,
    SETTING_RECITAL: 0,
    ACTIVE_CANON_USE: 4,
    CHARACTER_FIDELITY: 4,
    SCENE_ADVANCEMENT: 1,
    NEW_SCENE_VALUE: "LOW",
    OPENING_REPLAY_PARAGRAPHS: 1,
    REPLAY_SAVED_CHARS_REPLACED_BY_NEW_SCENE: "NO",
    SCENE_FULLY_DEVELOPED: "NO",
    COMPLETION: "FAIL",
    notes:
      "708 HARD density — less restage than A but starves new scene (≈ D2 T=658). Length recovery FAIL.",
  },
  Gemini_G5_A: {
    CURRENT_INPUT_REPLAY: 1,
    INTRO_REPLAY: 2,
    SETTING_RECITAL: 2,
    ACTIVE_CANON_USE: 4,
    CHARACTER_FIDELITY: 4,
    SCENE_ADVANCEMENT: 2,
    NEW_SCENE_VALUE: "HIGH",
    OPENING_REPLAY_PARAGRAPHS: 2,
    REPLAY_SAVED_CHARS_REPLACED_BY_NEW_SCENE: "N/A",
    SCENE_FULLY_DEVELOPED: "YES",
    COMPLETION: "PASS",
    notes: "3384 IDEAL length; heavy ecology/setting plane before physical reaction",
  },
  Gemini_G5_C: {
    CURRENT_INPUT_REPLAY: 1,
    INTRO_REPLAY: 1,
    SETTING_RECITAL: 1,
    ACTIVE_CANON_USE: 4,
    CHARACTER_FIDELITY: 4,
    SCENE_ADVANCEMENT: 2,
    NEW_SCENE_VALUE: "MEDIUM",
    OPENING_REPLAY_PARAGRAPHS: 1,
    REPLAY_SAVED_CHARS_REPLACED_BY_NEW_SCENE: "PARTIAL",
    SCENE_FULLY_DEVELOPED: "NO",
    COMPLETION: "FAIL",
    notes:
      "1919 STRONG REVIEW; faster physical reaction (hand over mouth) but relative length ≪ A*0.70",
  },
  Gemini_G3_A: {
    CURRENT_INPUT_REPLAY: 1,
    INTRO_REPLAY: 0,
    SETTING_RECITAL: 1,
    ACTIVE_CANON_USE: 5,
    CHARACTER_FIDELITY: 5,
    SCENE_ADVANCEMENT: 2,
    NEW_SCENE_VALUE: "HIGH",
    OPENING_REPLAY_PARAGRAPHS: 0,
    REPLAY_SAVED_CHARS_REPLACED_BY_NEW_SCENE: "N/A",
    SCENE_FULLY_DEVELOPED: "YES",
    COMPLETION: "PASS",
    notes: "2689: 총성=죽음 refuse via action+judgment; canon as consequence",
  },
  Gemini_G3_C: {
    CURRENT_INPUT_REPLAY: 1,
    INTRO_REPLAY: 0,
    SETTING_RECITAL: 1,
    ACTIVE_CANON_USE: 5,
    CHARACTER_FIDELITY: 5,
    SCENE_ADVANCEMENT: 2,
    NEW_SCENE_VALUE: "MEDIUM",
    OPENING_REPLAY_PARAGRAPHS: 1,
    REPLAY_SAVED_CHARS_REPLACED_BY_NEW_SCENE: "PARTIAL",
    SCENE_FULLY_DEVELOPED: "NO",
    COMPLETION: "FAIL",
    notes:
      "1759 density collapse; canon/fidelity preserved (총성=죽음) but length regress vs A",
  },
};

function main() {
  const live = JSON.parse(
    readFileSync(join(DOCS, "02_STAGE1_LIVE.json"), "utf8")
  ) as {
    api_calls_this_run: number;
    rows: Array<Record<string, unknown>>;
  };
  const byId = Object.fromEntries(
    live.rows.map((r) => [String(r.cell_id), r])
  ) as Record<string, Record<string, unknown>>;

  const chars = (id: string) =>
    Number(byId[id]?.visible_chars_no_ws ?? 0);
  const dlg = (id: string) =>
    Number(byId[id]?.dialogue_char_share ?? 0);
  const frag = (id: string) =>
    Number(byId[id]?.same_speaker_dialogue_fragments ?? 0);

  const g6A = chars("Gemini_G6T1_A");
  const g6C = chars("Gemini_G6T1_C");
  const g5A = chars("Gemini_G5_A");
  const g5C = chars("Gemini_G5_C");
  const g3A = chars("Gemini_G3_A");
  const g3C = chars("Gemini_G3_C");

  const g6LengthRecoveryFail = g6C < 1800 || g6C < g6A * 0.7;
  // Historical D2 T
  const d2T_G6 = 658;

  const gates = {
    g6ReplayImproved:
      HUMAN.Gemini_G6T1_C!.CURRENT_INPUT_REPLAY <
      HUMAN.Gemini_G6T1_A!.CURRENT_INPUT_REPLAY,
    g6LengthRecovery: !g6LengthRecoveryFail,
    g6ReplacementContent:
      HUMAN.Gemini_G6T1_C!.REPLAY_SAVED_CHARS_REPLACED_BY_NEW_SCENE,
    g5IntroImproved:
      HUMAN.Gemini_G5_C!.INTRO_REPLAY <= 1 &&
      HUMAN.Gemini_G5_C!.SETTING_RECITAL <= 1,
    g5RelativeLengthOk: g5C >= g5A * 0.7,
    g3CanonOk:
      HUMAN.Gemini_G3_C!.ACTIVE_CANON_USE >=
        HUMAN.Gemini_G3_A!.ACTIVE_CANON_USE &&
      HUMAN.Gemini_G3_C!.CHARACTER_FIDELITY >=
        HUMAN.Gemini_G3_A!.CHARACTER_FIDELITY,
    g3RelativeLengthOk: g3C >= g3A * 0.7,
  };

  const final = g6LengthRecoveryFail
    ? "GEMINI_CONTEXT_BOUNDARY_PLACEMENT_FAIL"
    : gates.g6ReplayImproved &&
        gates.g5IntroImproved &&
        gates.g3CanonOk &&
        gates.g5RelativeLengthOk
      ? "GEMINI_CONTEXT_BOUNDARY_PLACEMENT_PASS"
      : "GEMINI_CONTEXT_BOUNDARY_PLACEMENT_MIXED";

  const classification =
    g6LengthRecoveryFail
      ? "PLACEMENT_NOT_SUFFICIENT — C still collapses length (G6 C≈D2 T); do not search more placements; next would be structural context packaging (NOT implemented in D3)."
      : "see gates";

  mkdirSync(DOCS, { recursive: true });
  writeFileSync(
    join(DOCS, "03_HUMAN_SEAL.json"),
    JSON.stringify(
      {
        note: "Full RAW read scores",
        wording_sha256: createHash("sha256")
          .update(GEMINI_SCENE_CONTINUITY_BLOCK)
          .digest("hex"),
        scores: HUMAN,
        gates,
        final,
      },
      null,
      2
    ),
    "utf8"
  );

  if (existsSync(join(DOCS, "08_HIDDEN_MAP.json"))) {
    const hidden = JSON.parse(
      readFileSync(join(DOCS, "08_HIDDEN_MAP.json"), "utf8")
    );
    writeFileSync(
      join(DOCS, "09_REVEAL.json"),
      JSON.stringify(
        { revealed_after_seal: true, blindMap: hidden.blindMap },
        null,
        2
      ),
      "utf8"
    );
  }

  const status = {
    PHASE_D3_STATUS: true,
    baseline_main: "268b8a70556f3392e7eb89283ba2e07689e2e332",
    branch: "cursor/rp-gemini-content-boundary-d3-96c2",
    commit: "PENDING_PUSH",
    draft_PR: "https://github.com/you8520-sketch/chat-ai/pull/278",
    D2_wording: "BYTE_IDENTICAL",
    offline_owner_map: "PASS",
    continuity_current_D2_placement: "SYSTEM_TAIL",
    context_boundary_insertion_point:
      "immediately before [OUTPUT LAYOUT] / rule-output-layout-recency (src/lib/geminiSceneContinuityAdapter.ts insertGeminiSceneContinuityBeforeOutputLayout)",
    length_owner_position:
      "user-tail USER_TAIL_LENGTH_OWNER_SENTENCE (src/lib/responseLength.ts)",
    user_terminal_owner_position:
      "layout line + length sentence after [CURRENT USER INPUT] body",
    Stage1_calls: 6,
    "G6-T1": {
      A_chars: g6A,
      C_chars: g6C,
      T_historical_chars: d2T_G6,
      A_input_replay: HUMAN.Gemini_G6T1_A!.CURRENT_INPUT_REPLAY,
      C_input_replay: HUMAN.Gemini_G6T1_C!.CURRENT_INPUT_REPLAY,
      A_new_scene_value: HUMAN.Gemini_G6T1_A!.NEW_SCENE_VALUE,
      C_new_scene_value: HUMAN.Gemini_G6T1_C!.NEW_SCENE_VALUE,
      replacement_content:
        HUMAN.Gemini_G6T1_C!.REPLAY_SAVED_CHARS_REPLACED_BY_NEW_SCENE,
      winner: "A (C length recovery FAIL)",
    },
    G5: {
      A_chars: g5A,
      C_chars: g5C,
      A_intro_replay: HUMAN.Gemini_G5_A!.INTRO_REPLAY,
      C_intro_replay: HUMAN.Gemini_G5_C!.INTRO_REPLAY,
      A_recital: HUMAN.Gemini_G5_A!.SETTING_RECITAL,
      C_recital: HUMAN.Gemini_G5_C!.SETTING_RECITAL,
      A_new_scene_value: HUMAN.Gemini_G5_A!.NEW_SCENE_VALUE,
      C_new_scene_value: HUMAN.Gemini_G5_C!.NEW_SCENE_VALUE,
      winner: "A (C relative length FAIL; replay directionally ok)",
    },
    G3: {
      A_active_canon: HUMAN.Gemini_G3_A!.ACTIVE_CANON_USE,
      C_active_canon: HUMAN.Gemini_G3_C!.ACTIVE_CANON_USE,
      A_fidelity: HUMAN.Gemini_G3_A!.CHARACTER_FIDELITY,
      C_fidelity: HUMAN.Gemini_G3_C!.CHARACTER_FIDELITY,
      A_recital: HUMAN.Gemini_G3_A!.SETTING_RECITAL,
      C_recital: HUMAN.Gemini_G3_C!.SETTING_RECITAL,
      A_chars: g3A,
      C_chars: g3C,
      winner: "TIE on canon (C density collapse)",
    },
    density_collapse: {
      A: live.rows
        .filter(
          (r) =>
            r.arm === "A" &&
            Array.isArray(r.hard_alarms) &&
            (r.hard_alarms as string[]).includes("DENSITY_COLLAPSE")
        )
        .map((r) => r.cell_id),
      C: live.rows
        .filter(
          (r) =>
            r.arm === "C" &&
            Array.isArray(r.hard_alarms) &&
            (r.hard_alarms as string[]).includes("DENSITY_COLLAPSE")
        )
        .map((r) => r.cell_id),
    },
    completion: {
      A: {
        G6T1: HUMAN.Gemini_G6T1_A!.COMPLETION,
        G5: HUMAN.Gemini_G5_A!.COMPLETION,
        G3: HUMAN.Gemini_G3_A!.COMPLETION,
      },
      C: {
        G6T1: HUMAN.Gemini_G6T1_C!.COMPLETION,
        G5: HUMAN.Gemini_G5_C!.COMPLETION,
        G3: HUMAN.Gemini_G3_C!.COMPLETION,
      },
    },
    dialogue_char_share: {
      G6T1: { A: dlg("Gemini_G6T1_A"), C: dlg("Gemini_G6T1_C") },
      G5: { A: dlg("Gemini_G5_A"), C: dlg("Gemini_G5_C") },
      G3: { A: dlg("Gemini_G3_A"), C: dlg("Gemini_G3_C") },
    },
    same_speaker_fragmentation: {
      G6T1: { A: frag("Gemini_G6T1_A"), C: frag("Gemini_G6T1_C") },
      G5: { A: frag("Gemini_G5_A"), C: frag("Gemini_G5_C") },
      G3: { A: frag("Gemini_G3_A"), C: frag("Gemini_G3_C") },
    },
    confirmation: "NOT_RUN",
    calls_confirmation: 0,
    stop_reason: g6LengthRecoveryFail
      ? "G6 length recovery FAIL — stop further placement search"
      : null,
    final,
    classification_note: classification,
    production_wire: "NOT_RUN",
    common_prompt: "UNCHANGED",
    adapter_estimated_tokens: estimateGeminiSceneContinuityTokens(),
    DeepSeek: "NOT_RUN",
    Opus: "NOT_RUN",
    Terra: "NOT_RUN",
    numeric_diff: 0,
  };

  const md = [
    "# PHASE_D3_STATUS",
    "",
    "```text",
    JSON.stringify(status, null, 2),
    "```",
    "",
    "## Human scores (full RAW read)",
    "",
    "| Cell | INPUT | INTRO | SETTING | CANON | FIDELITY | SCENE | NEW_VALUE | REPLACE | FULL? | COMPLETION |",
    "|------|------:|------:|--------:|------:|---------:|------:|----------:|:-------:|:-----:|:----------:|",
    ...Object.entries(HUMAN).map(
      ([id, s]) =>
        `| ${id} | ${s.CURRENT_INPUT_REPLAY} | ${s.INTRO_REPLAY} | ${s.SETTING_RECITAL} | ${s.ACTIVE_CANON_USE} | ${s.CHARACTER_FIDELITY} | ${s.SCENE_ADVANCEMENT} | ${s.NEW_SCENE_VALUE} | ${s.REPLAY_SAVED_CHARS_REPLACED_BY_NEW_SCENE} | ${s.SCENE_FULLY_DEVELOPED} | ${s.COMPLETION} |`
    ),
    "",
    `## Verdict`,
    "",
    `**${final}** — confirmation NOT_RUN; production wire NOT_RUN.`,
    "",
    classification,
    "",
  ].join("\n");

  writeFileSync(join(DOCS, "PHASE_D3_STATUS.md"), md, "utf8");
  console.log(JSON.stringify({ final, gates, g6A, g6C, g5A, g5C, g3A, g3C }, null, 2));
}

main();
