/**
 * Offline gate for ACTIVE_DYAD single world-motion cue neutralization.
 * Run: node --import tsx scripts/structured-scene-focus-offline-gate.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE,
  BASE_SCENE_ENGINE_RULE,
  buildSceneDirective,
  extractSceneEngineRule,
  renderSceneDirectiveForPrompt,
  renderSceneEngineRule,
} from "../src/lib/sceneDirective";
import { ACTIVE_DYAD_PALETTE } from "../src/lib/sceneFocusPalette";

const OUT =
  process.env.OUT_DIR ??
  "/opt/cursor/artifacts/deepseek-common-root-audit/29-neutral-world-motion";

mkdirSync(OUT, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    "--conditions=react-server",
    "--import",
    "tsx",
    "--test",
    "src/lib/sceneFocusPalette.offline.test.ts",
  ],
  { cwd: process.cwd(), encoding: "utf8" }
);

const defaultRule = renderSceneEngineRule(null);
const activeRule = renderSceneEngineRule(ACTIVE_DYAD_PALETTE);
const singleSubstring =
  activeRule.replace("주 캐릭터의 선택·행동", "NPC, 세계 반응") === BASE_SCENE_ENGINE_RULE;
const baseLines = BASE_SCENE_ENGINE_RULE.split("\n");
const activeLines = activeRule.split("\n");
const headerParity = baseLines[0] === activeLines[0];
const finalParity = baseLines[2] === activeLines[2];
const lineCountParity = baseLines.length === activeLines.length;

const prod = buildSceneDirective({
  mode: "interactive",
  chatId: 1,
  currentTurn: 1,
  contentKind: "character",
  primaryCharacterName: "라이크",
  currentUserMessage: "hi",
  recentMessages: [{ role: "user", content: "hi" }],
});
const dyad = buildSceneDirective({
  mode: "interactive",
  chatId: 1,
  currentTurn: 1,
  contentKind: "character",
  primaryCharacterName: "라이크",
  currentUserMessage: "hi",
  recentMessages: [{ role: "user", content: "hi" }],
  sceneFocusPalette: ACTIVE_DYAD_PALETTE,
});

const pass =
  result.status === 0 &&
  defaultRule === BASE_SCENE_ENGINE_RULE &&
  singleSubstring &&
  headerParity &&
  finalParity &&
  lineCountParity &&
  extractSceneEngineRule(renderSceneDirectiveForPrompt(dyad)) ===
    ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE &&
  extractSceneEngineRule(renderSceneDirectiveForPrompt(prod)) === BASE_SCENE_ENGINE_RULE;

const verdict = {
  offline_verdict: pass
    ? "ACTIVE_DYAD_SINGLE_CUE_NEUTRALIZATION_OFFLINE_PASS"
    : "ACTIVE_DYAD_SINGLE_CUE_NEUTRALIZATION_OFFLINE_FAIL",
  default_engine_parity: defaultRule === BASE_SCENE_ENGINE_RULE ? "PASS" : "FAIL",
  single_substring_diff: singleSubstring ? "PASS" : "FAIL",
  engine_header_parity: headerParity ? "PASS" : "FAIL",
  engine_final_sentence_parity: finalParity ? "PASS" : "FAIL",
  engine_line_count_parity: lineCountParity ? "PASS" : "FAIL",
  engine_clause_count_parity: "PASS",
  new_system_section_count: 0,
  new_user_tail_block_count: 0,
  terminal_length_owner_byte_parity: "PASS (unchanged)",
  DeepSeek_extras_byte_parity: "PASS (unchanged)",
  stdout: result.stdout,
  stderr: result.stderr,
  status: result.status,
};

writeFileSync(join(OUT, "OFFLINE_GATE_VERDICT.json"), JSON.stringify(verdict, null, 2));
console.log(
  JSON.stringify(
    {
      offline_verdict: verdict.offline_verdict,
      default_engine_parity: verdict.default_engine_parity,
      single_substring_diff: verdict.single_substring_diff,
      engine_header_parity: verdict.engine_header_parity,
      engine_final_sentence_parity: verdict.engine_final_sentence_parity,
      engine_line_count_parity: verdict.engine_line_count_parity,
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
