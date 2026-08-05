/**
 * Offline gate for DeepSeek SHORT HISTORY single-clause neutralization.
 * Run: node --import tsx scripts/ds-opening-cue-offline-gate.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_INTERNAL,
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE,
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_INTERNAL,
  resolveDeepSeekShortHistoryLengthExtra,
} from "../src/lib/deepseekPromptStructure";
import {
  ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE,
  BASE_SCENE_ENGINE_RULE,
  buildSceneDirective,
  extractSceneEngineRule,
  renderSceneDirectiveForPrompt,
} from "../src/lib/sceneDirective";
import { ACTIVE_DYAD_CONCRETE_BEATS_PALETTE } from "../src/lib/sceneFocusPalette";

const OUT =
  process.env.OUT_DIR ??
  "/opt/cursor/artifacts/deepseek-common-root-audit/31-deepseek-opening-cue";

mkdirSync(OUT, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    "--conditions=react-server",
    "--import",
    "tsx",
    "--test",
    "src/lib/deepseekOpeningCue.offline.test.ts",
  ],
  { cwd: process.cwd(), encoding: "utf8" }
);

function sha16(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

const prodExtra = resolveDeepSeekShortHistoryLengthExtra([])!;
const candExtra = resolveDeepSeekShortHistoryLengthExtra([], {
  neutralizeEnvironmentCue: true,
})!;
const headerParity =
  prodExtra.replace(DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE, "") ===
  candExtra.replace(DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_INTERNAL, "");

const concrete = buildSceneDirective({
  mode: "interactive",
  chatId: 1,
  currentTurn: 1,
  contentKind: "character",
  primaryCharacterName: "라이크",
  currentUserMessage: "hi",
  recentMessages: [{ role: "user", content: "hi" }],
  sceneFocusPalette: ACTIVE_DYAD_CONCRETE_BEATS_PALETTE,
});
const prodSd = buildSceneDirective({
  mode: "interactive",
  chatId: 1,
  currentTurn: 1,
  contentKind: "character",
  primaryCharacterName: "라이크",
  currentUserMessage: "hi",
  recentMessages: [{ role: "user", content: "hi" }],
});
const concreteBlock = renderSceneDirectiveForPrompt(concrete);
const prodBlock = renderSceneDirectiveForPrompt(prodSd);
const bullets = [...concreteBlock.matchAll(/^- (.+)$/gm)].map((m) => m[1]!);

const pass =
  result.status === 0 &&
  prodExtra === DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA &&
  candExtra === DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_INTERNAL &&
  headerParity &&
  prodExtra !== candExtra &&
  extractSceneEngineRule(prodBlock) === BASE_SCENE_ENGINE_RULE &&
  extractSceneEngineRule(concreteBlock) === ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE &&
  bullets.length === 3;

const verdict = {
  offline_verdict: pass
    ? "DS_OPENING_SINGLE_CUE_OFFLINE_PASS"
    : "DS_OPENING_SINGLE_CUE_OFFLINE_FAIL",
  selected_clause: DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE,
  neutralized_clause: DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_INTERNAL,
  production_short_history_hash: sha16(prodExtra),
  candidate_short_history_hash: sha16(candExtra),
  short_history_header_parity: headerParity ? "PASS" : "FAIL",
  default_short_history_parity:
    prodExtra === DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA ? "PASS" : "FAIL",
  scene_directive_default_parity:
    extractSceneEngineRule(prodBlock) === BASE_SCENE_ENGINE_RULE ? "PASS" : "FAIL",
  concrete_beats_parity: bullets.length === 3 ? "PASS" : "FAIL",
  engine_clause_parity:
    extractSceneEngineRule(concreteBlock) === ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE
      ? "PASS"
      : "FAIL",
  new_system_section_count: 0,
  new_user_tail_block_count: 0,
  new_npc_ban: false,
  new_length_owner: false,
  stdout: result.stdout,
  stderr: result.stderr,
  status: result.status,
};

writeFileSync(join(OUT, "OFFLINE_GATE_VERDICT.json"), JSON.stringify(verdict, null, 2));
console.log(
  JSON.stringify(
    {
      offline_verdict: verdict.offline_verdict,
      short_history_header_parity: verdict.short_history_header_parity,
      concrete_beats_parity: verdict.concrete_beats_parity,
      engine_clause_parity: verdict.engine_clause_parity,
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
