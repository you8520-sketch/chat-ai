/**
 * Phase D2 — human seal scores + PHASE_D2_STATUS (API=0).
 * Scores from full RAW output reads in docs/audits/rp-quality-v2-gemini/d2/raw/.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { estimateGeminiSceneContinuityTokens } from "../src/lib/geminiSceneContinuityAdapter";

const DOCS = join("docs/audits/rp-quality-v2-gemini", "d2");

type Scores = {
  CURRENT_INPUT_REPLAY: number;
  INTRO_REPLAY: number;
  SETTING_RECITAL: number;
  USER_PERSONA_PARROT: number;
  INTRA_TURN_REEXPLANATION: number;
  ACTIVE_CANON_USE: number;
  CHARACTER_FIDELITY: number;
  SCENE_ADVANCEMENT: number;
  NPC_ENVIRONMENT_MOTION: number;
  PROSE_QUALITY: number;
  NEW_SCENE_VALUE: "LOW" | "MEDIUM" | "HIGH";
  COMPLETION: "PASS" | "FAIL";
  notes: string;
};

const HUMAN: Record<string, Scores> = {
  Gemini_G5_A: {
    CURRENT_INPUT_REPLAY: 1,
    INTRO_REPLAY: 2,
    SETTING_RECITAL: 2,
    USER_PERSONA_PARROT: 1,
    INTRA_TURN_REEXPLANATION: 1,
    ACTIVE_CANON_USE: 3,
    CHARACTER_FIDELITY: 4,
    SCENE_ADVANCEMENT: 2,
    NPC_ENVIRONMENT_MOTION: 3,
    PROSE_QUALITY: 3,
    NEW_SCENE_VALUE: "MEDIUM",
    COMPLETION: "FAIL",
    notes: "1500 chars density collapse; intro/setting plane before reaction",
  },
  Gemini_G5_B: {
    CURRENT_INPUT_REPLAY: 1,
    INTRO_REPLAY: 1,
    SETTING_RECITAL: 1,
    USER_PERSONA_PARROT: 1,
    INTRA_TURN_REEXPLANATION: 1,
    ACTIVE_CANON_USE: 4,
    CHARACTER_FIDELITY: 4,
    SCENE_ADVANCEMENT: 2,
    NPC_ENVIRONMENT_MOTION: 4,
    PROSE_QUALITY: 4,
    NEW_SCENE_VALUE: "HIGH",
    COMPLETION: "PASS",
    notes: "2672 chars; reacts then advances (creature enter / hide); less intro restage",
  },
  Gemini_G6T1_A: {
    CURRENT_INPUT_REPLAY: 3,
    INTRO_REPLAY: 0,
    SETTING_RECITAL: 1,
    USER_PERSONA_PARROT: 1,
    INTRA_TURN_REEXPLANATION: 1,
    ACTIVE_CANON_USE: 4,
    CHARACTER_FIDELITY: 4,
    SCENE_ADVANCEMENT: 2,
    NPC_ENVIRONMENT_MOTION: 3,
    PROSE_QUALITY: 3,
    NEW_SCENE_VALUE: "MEDIUM",
    COMPLETION: "PASS",
    notes: "Cinematic restage of scream/metal before NPC reaction; auto CURRENT_INPUT signal",
  },
  Gemini_G6T1_B: {
    CURRENT_INPUT_REPLAY: 1,
    INTRO_REPLAY: 0,
    SETTING_RECITAL: 0,
    USER_PERSONA_PARROT: 1,
    INTRA_TURN_REEXPLANATION: 0,
    ACTIVE_CANON_USE: 3,
    CHARACTER_FIDELITY: 4,
    SCENE_ADVANCEMENT: 2,
    NPC_ENVIRONMENT_MOTION: 2,
    PROSE_QUALITY: 2,
    NEW_SCENE_VALUE: "LOW",
    COMPLETION: "FAIL",
    notes: "658 chars HARD LENGTH / density collapse; less restage but starves new scene",
  },
  Gemini_G3_A: {
    CURRENT_INPUT_REPLAY: 1,
    INTRO_REPLAY: 0,
    SETTING_RECITAL: 1,
    USER_PERSONA_PARROT: 0,
    INTRA_TURN_REEXPLANATION: 0,
    ACTIVE_CANON_USE: 5,
    CHARACTER_FIDELITY: 5,
    SCENE_ADVANCEMENT: 2,
    NPC_ENVIRONMENT_MOTION: 4,
    PROSE_QUALITY: 3,
    NEW_SCENE_VALUE: "HIGH",
    COMPLETION: "FAIL",
    notes: "Canon gunshot refuse strong; 1123 density collapse",
  },
  Gemini_G3_B: {
    CURRENT_INPUT_REPLAY: 1,
    INTRO_REPLAY: 0,
    SETTING_RECITAL: 0,
    USER_PERSONA_PARROT: 0,
    INTRA_TURN_REEXPLANATION: 0,
    ACTIVE_CANON_USE: 5,
    CHARACTER_FIDELITY: 5,
    SCENE_ADVANCEMENT: 2,
    NPC_ENVIRONMENT_MOTION: 3,
    PROSE_QUALITY: 3,
    NEW_SCENE_VALUE: "MEDIUM",
    COMPLETION: "FAIL",
    notes: "Canon preserved (총성=죽음); 819 density collapse / relative length regress vs A",
  },
  Gemini_G2_A: {
    CURRENT_INPUT_REPLAY: 1,
    INTRO_REPLAY: 1,
    SETTING_RECITAL: 1,
    USER_PERSONA_PARROT: 2,
    INTRA_TURN_REEXPLANATION: 1,
    ACTIVE_CANON_USE: 4,
    CHARACTER_FIDELITY: 4,
    SCENE_ADVANCEMENT: 2,
    NPC_ENVIRONMENT_MOTION: 3,
    PROSE_QUALITY: 3,
    NEW_SCENE_VALUE: "MEDIUM",
    COMPLETION: "FAIL",
    notes: "No knowledge leak; persona checklist line; 1633 density collapse",
  },
  Gemini_G2_B: {
    CURRENT_INPUT_REPLAY: 1,
    INTRO_REPLAY: 0,
    SETTING_RECITAL: 1,
    USER_PERSONA_PARROT: 1,
    INTRA_TURN_REEXPLANATION: 1,
    ACTIVE_CANON_USE: 4,
    CHARACTER_FIDELITY: 4,
    SCENE_ADVANCEMENT: 2,
    NPC_ENVIRONMENT_MOTION: 3,
    PROSE_QUALITY: 3,
    NEW_SCENE_VALUE: "MEDIUM",
    COMPLETION: "FAIL",
    notes: "No knowledge leak; less parrot; 1748 still density collapse",
  },
};

function main() {
  const live = JSON.parse(
    readFileSync(join(DOCS, "01_STAGE1_LIVE.json"), "utf8")
  ) as {
    rows: Array<Record<string, unknown>>;
    api_calls_this_run: number;
    adapter_estimated_tokens: number;
  };

  const byId = Object.fromEntries(
    live.rows.map((r) => [String(r.cell_id), r])
  );

  function pair(fixture: string) {
    const a = byId[`Gemini_${fixture}_A`]!;
    const b = byId[`Gemini_${fixture}_B`]!;
    const ha = HUMAN[`Gemini_${fixture}_A`]!;
    const hb = HUMAN[`Gemini_${fixture}_B`]!;
    return { a, b, ha, hb };
  }

  const g5 = pair("G5");
  const g6 = pair("G6T1");
  const g3 = pair("G3");
  const g2 = pair("G2");

  const bHardLengthFails = live.rows.filter(
    (r) =>
      r.arm === "B" &&
      (r.length_band === "DENSITY_COLLAPSE" ||
        Number(r.visible_chars_no_ws) < 1800)
  ).map((r) => r.cell_id);

  const bRelativeLengthFails = ["G5", "G6T1", "G3", "G2"].filter((f) => {
    const a = Number(byId[`Gemini_${f}_A`]!.visible_chars_no_ws);
    const b = Number(byId[`Gemini_${f}_B`]!.visible_chars_no_ws);
    return b < a * 0.7;
  });

  const knowledgeLeak = live.rows.some((r) => Number(r.knowledge_leak) === 1);
  const agency = live.rows.some((r) => Number(r.agency_severe) === 1);

  // Acceptance checks
  const g5ReplayImproved =
    g5.hb.INTRO_REPLAY < g5.ha.INTRO_REPLAY ||
    g5.hb.CURRENT_INPUT_REPLAY < g5.ha.CURRENT_INPUT_REPLAY;
  const g5SceneOk =
    g5.hb.SCENE_ADVANCEMENT >= g5.ha.SCENE_ADVANCEMENT &&
    (g5.hb.NEW_SCENE_VALUE === "HIGH" ||
      g5.hb.NEW_SCENE_VALUE === g5.ha.NEW_SCENE_VALUE ||
      (g5.ha.NEW_SCENE_VALUE === "LOW" && g5.hb.NEW_SCENE_VALUE !== "LOW"));
  const g6ReplayImproved =
    g6.hb.CURRENT_INPUT_REPLAY < g6.ha.CURRENT_INPUT_REPLAY;
  const g3CanonOk =
    g3.hb.ACTIVE_CANON_USE >= g3.ha.ACTIVE_CANON_USE &&
    g3.hb.CHARACTER_FIDELITY >= g3.ha.CHARACTER_FIDELITY;
  const g2LeakOk = !knowledgeLeak;

  const final =
    bHardLengthFails.length === 0 &&
    bRelativeLengthFails.length === 0 &&
    !agency &&
    g2LeakOk &&
    g5ReplayImproved &&
    g5SceneOk &&
    g6ReplayImproved &&
    g6.hb.SCENE_ADVANCEMENT >= g6.ha.SCENE_ADVANCEMENT &&
    g3CanonOk &&
    g5.hb.COMPLETION === "PASS" &&
    g6.hb.COMPLETION === "PASS"
      ? "GEMINI_SCENE_CONTINUITY_PASS"
      : bHardLengthFails.length > 0 || bRelativeLengthFails.length > 0
        ? "GEMINI_SCENE_CONTINUITY_FAIL"
        : "GEMINI_SCENE_CONTINUITY_MIXED";

  const status = {
    PHASE_D2_STATUS: {
      latest_main: "b586a5bf7f506a8da3f6d3b9252ac0f1b82217c1",
      branch: "cursor/rp-quality-v2-gemini-grounding-6a91",
      commit: "PENDING_PUSH",
      PR: "https://github.com/you8520-sketch/chat-ai/pull/275",
      production_prompt: "UNCHANGED",
      Gemini_adapter: {
        A: "absent",
        B: "candidate GEMINI_SCENE_CONTINUITY",
      },
      adapter_estimated_tokens: estimateGeminiSceneContinuityTokens(),
      RAW_outputs_committed: "YES",
      Stage1_calls: "8 / STOP EARLY (no confirmation)",
      G5: {
        A_chars: g5.a.visible_chars_no_ws,
        B_chars: g5.b.visible_chars_no_ws,
        A_intro_replay: g5.ha.INTRO_REPLAY,
        B_intro_replay: g5.hb.INTRO_REPLAY,
        A_setting_recital: g5.ha.SETTING_RECITAL,
        B_setting_recital: g5.hb.SETTING_RECITAL,
        A_scene_advance: g5.ha.SCENE_ADVANCEMENT,
        B_scene_advance: g5.hb.SCENE_ADVANCEMENT,
        A_new_scene_value: g5.ha.NEW_SCENE_VALUE,
        B_new_scene_value: g5.hb.NEW_SCENE_VALUE,
        winner: "B (replay/scene) but A length also collapsed",
      },
      "G6-T1": {
        A_chars: g6.a.visible_chars_no_ws,
        B_chars: g6.b.visible_chars_no_ws,
        A_input_replay: g6.ha.CURRENT_INPUT_REPLAY,
        B_input_replay: g6.hb.CURRENT_INPUT_REPLAY,
        A_scene_advance: g6.ha.SCENE_ADVANCEMENT,
        B_scene_advance: g6.hb.SCENE_ADVANCEMENT,
        winner: "A (B HARD length fail 658)",
      },
      G3: {
        active_canon_A_B: `${g3.ha.ACTIVE_CANON_USE}/${g3.hb.ACTIVE_CANON_USE}`,
        character_fidelity_A_B: `${g3.ha.CHARACTER_FIDELITY}/${g3.hb.CHARACTER_FIDELITY}`,
        recital_A_B: `${g3.ha.SETTING_RECITAL}/${g3.hb.SETTING_RECITAL}`,
        winner: "TIE on canon (B shorter / density collapse)",
      },
      G2: {
        persona_parrot_A_B: `${g2.ha.USER_PERSONA_PARROT}/${g2.hb.USER_PERSONA_PARROT}`,
        knowledge_leak_A_B: "0/0",
        active_canon_A_B: `${g2.ha.ACTIVE_CANON_USE}/${g2.hb.ACTIVE_CANON_USE}`,
        winner: "B slight (parrot↓) — both density collapse",
      },
      dialogue_char_share_AB: Object.fromEntries(
        ["G5", "G6T1", "G3", "G2"].map((f) => [
          f,
          {
            A: byId[`Gemini_${f}_A`]!.dialogue_char_share,
            B: byId[`Gemini_${f}_B`]!.dialogue_char_share,
          },
        ])
      ),
      same_speaker_fragmentation_AB: Object.fromEntries(
        ["G5", "G6T1", "G3", "G2"].map((f) => [
          f,
          {
            A: byId[`Gemini_${f}_A`]!.same_speaker_dialogue_fragments,
            B: byId[`Gemini_${f}_B`]!.same_speaker_dialogue_fragments,
          },
        ])
      ),
      density_collapse: {
        A: live.rows
          .filter((r) => r.arm === "A" && r.length_band === "DENSITY_COLLAPSE")
          .map((r) => r.cell_id),
        B: bHardLengthFails,
      },
      completion: {
        A: Object.fromEntries(
          live.rows
            .filter((r) => r.arm === "A")
            .map((r) => [r.cell_id, HUMAN[String(r.cell_id)]!.COMPLETION])
        ),
        B: Object.fromEntries(
          live.rows
            .filter((r) => r.arm === "B")
            .map((r) => [r.cell_id, HUMAN[String(r.cell_id)]!.COMPLETION])
        ),
      },
      agency_severe: { A: 0, B: 0 },
      confirmation: "NOT_RUN",
      confirmation_calls: 0,
      final,
      production_wire: "NOT_RUN",
      DeepSeek: "NOT_RUN",
      Opus: "NOT_RUN",
      Terra: "NOT_RUN",
      gates: {
        g5ReplayImproved,
        g5SceneOk,
        g6ReplayImproved,
        g3CanonOk,
        g2LeakOk,
        bHardLengthFails,
        bRelativeLengthFails,
        knowledgeLeak,
        agency,
      },
      classification_note:
        "Directional G5 replay↓ + G6 input-restage↓ observed, but B density-collapse / relative length regression (esp. G6T1_B=658) → FAIL. Do not accumulate patch sentences. Next: content-boundary / placement audit separately.",
    },
    human_scores: HUMAN,
  };

  mkdirSync(DOCS, { recursive: true });
  writeFileSync(join(DOCS, "02_HUMAN_SEAL.json"), JSON.stringify(status, null, 2));
  writeFileSync(
    join(DOCS, "PHASE_D2_STATUS.md"),
    [
      "# PHASE_D2_STATUS",
      "",
      "```text",
      JSON.stringify(status.PHASE_D2_STATUS, null, 2),
      "```",
      "",
      "## Human scores (full RAW read)",
      "",
      "| Cell | INTRO | INPUT | SETTING | CANON | FIDELITY | SCENE | NEW_VALUE | COMPLETION |",
      "|------|------:|------:|--------:|------:|---------:|------:|----------:|:----------:|",
      ...Object.entries(HUMAN).map(
        ([id, h]) =>
          `| ${id} | ${h.INTRO_REPLAY} | ${h.CURRENT_INPUT_REPLAY} | ${h.SETTING_RECITAL} | ${h.ACTIVE_CANON_USE} | ${h.CHARACTER_FIDELITY} | ${h.SCENE_ADVANCEMENT} | ${h.NEW_SCENE_VALUE} | ${h.COMPLETION} |`
      ),
      "",
      "## Verdict",
      "",
      `**${final}** — confirmation NOT_RUN; production wire NOT_RUN.`,
      "",
      status.PHASE_D2_STATUS.classification_note,
      "",
    ].join("\n")
  );

  // Reveal blind map after seal
  try {
    const hidden = JSON.parse(
      readFileSync(join(DOCS, "08_HIDDEN_MAP.json"), "utf8")
    );
    writeFileSync(
      join(DOCS, "09_REVEAL.json"),
      JSON.stringify({ revealed_after_seal: true, ...hidden }, null, 2)
    );
  } catch {
    /* optional */
  }

  console.log(JSON.stringify(status.PHASE_D2_STATUS, null, 2));
}

main();
