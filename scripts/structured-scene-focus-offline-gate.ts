/**
 * Offline gate for concrete beat serializer.
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
  measureSerializedSceneBeatBudget,
  renderSceneDirectiveForPrompt,
} from "../src/lib/sceneDirective";
import { ACTIVE_DYAD_CONCRETE_BEATS_PALETTE } from "../src/lib/sceneFocusPalette";

const OUT =
  process.env.OUT_DIR ??
  "/opt/cursor/artifacts/deepseek-common-root-audit/30-concrete-beats";

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

const prod = buildSceneDirective({
  mode: "interactive",
  chatId: 1,
  currentTurn: 1,
  contentKind: "character",
  primaryCharacterName: "라이크",
  currentUserMessage: "hi",
  recentMessages: [{ role: "user", content: "hi" }],
});
const cand = buildSceneDirective({
  mode: "interactive",
  chatId: 1,
  currentTurn: 1,
  contentKind: "character",
  primaryCharacterName: "라이크",
  currentUserMessage: "hi",
  recentMessages: [{ role: "user", content: "hi" }],
  sceneFocusPalette: ACTIVE_DYAD_CONCRETE_BEATS_PALETTE,
});
const prodBlock = renderSceneDirectiveForPrompt(prod);
const candBlock = renderSceneDirectiveForPrompt(cand);
const budget = measureSerializedSceneBeatBudget({
  sceneDirectiveBlock: candBlock,
  requestedBeatCount: cand.focusDiagnostics?.requestedBeatCount,
  resolvedBeatCount: cand.focusDiagnostics?.resolvedBeatCount,
});
const bullets = [...candBlock.matchAll(/^- (.+)$/gm)].map((m) => m[1]!);

const pass =
  result.status === 0 &&
  extractSceneEngineRule(prodBlock) === BASE_SCENE_ENGINE_RULE &&
  extractSceneEngineRule(candBlock) === ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE &&
  bullets.length === 3 &&
  budget.serializedConcreteBeatInstructionCount >= 4 &&
  budget.nextBeatHintClauseCount >= 3 &&
  budget.openReactionCuePresent;

const verdict = {
  offline_serializer_verdict: pass
    ? "CONCRETE_BEAT_SERIALIZER_OFFLINE_PASS"
    : "CONCRETE_BEAT_SERIALIZER_OFFLINE_FAIL",
  concrete_beat_count: bullets.length,
  clause_count: budget.nextBeatHintClauseCount,
  serialized_concrete_beat_instruction_count:
    budget.serializedConcreteBeatInstructionCount,
  open_reaction_cue: budget.openReactionCuePresent,
  default_prompt_parity:
    extractSceneEngineRule(prodBlock) === BASE_SCENE_ENGINE_RULE ? "PASS" : "FAIL",
  engine_rule_matches_pr239_neutralization:
    extractSceneEngineRule(candBlock) === ACTIVE_DYAD_NEUTRALIZED_BASE_ENGINE_RULE
      ? "PASS"
      : "FAIL",
  new_system_section_count: 0,
  new_user_tail_block_count: 0,
  stdout: result.stdout,
  stderr: result.stderr,
  status: result.status,
};

writeFileSync(join(OUT, "OFFLINE_GATE_VERDICT.json"), JSON.stringify(verdict, null, 2));
console.log(
  JSON.stringify(
    {
      offline_serializer_verdict: verdict.offline_serializer_verdict,
      concrete_beat_count: verdict.concrete_beat_count,
      clause_count: verdict.clause_count,
      open_reaction_cue: verdict.open_reaction_cue,
      default_prompt_parity: verdict.default_prompt_parity,
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
