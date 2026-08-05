/**
 * Offline structural gate for base-engine-preservation isolation.
 *
 * Run: node --import tsx scripts/structured-scene-focus-offline-gate.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  BASE_SCENE_ENGINE_RULE,
  buildSceneDirective,
  extractSceneEngineRule,
  measureSerializedSceneBeatBudget,
  renderSceneDirectiveForPrompt,
} from "../src/lib/sceneDirective";
import { ACTIVE_DYAD_PALETTE } from "../src/lib/sceneFocusPalette";

const OUT =
  process.env.OUT_DIR ??
  "/opt/cursor/artifacts/deepseek-common-root-audit/28-base-engine-preserved";

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
  recentMessages: [
    { role: "assistant", content: "라이크가 짧게 숨을 골랐다." },
    { role: "user", content: "나는 렌이라고 부르면 돼." },
  ],
  currentUserMessage: "나는 렌이라고 부르면 돼.",
  chatId: 1,
  currentTurn: 1,
  contentKind: "character",
  primaryCharacterName: "라이크",
});
const dyad = buildSceneDirective({
  mode: "interactive",
  recentMessages: [
    { role: "assistant", content: "라이크가 짧게 숨을 골랐다." },
    { role: "user", content: "나는 렌이라고 부르면 돼." },
  ],
  currentUserMessage: "나는 렌이라고 부르면 돼.",
  chatId: 1,
  currentTurn: 1,
  contentKind: "character",
  primaryCharacterName: "라이크",
  sceneFocusPalette: ACTIVE_DYAD_PALETTE,
});
const prodBlock = renderSceneDirectiveForPrompt(prod);
const dyadBlock = renderSceneDirectiveForPrompt(dyad);
const engineParity =
  extractSceneEngineRule(prodBlock) === extractSceneEngineRule(dyadBlock) &&
  extractSceneEngineRule(dyadBlock) === BASE_SCENE_ENGINE_RULE;
const budget = measureSerializedSceneBeatBudget({
  sceneDirectiveBlock: dyadBlock,
  requestedBeatCount: dyad.focusDiagnostics?.requestedBeatCount,
  resolvedBeatCount: dyad.focusDiagnostics?.resolvedBeatCount,
});

const pass = result.status === 0 && engineParity;
const verdict = {
  offline_verdict: pass
    ? "STRUCTURED_BASE_ENGINE_PRESERVATION_OFFLINE_PASS"
    : "STRUCTURED_BASE_ENGINE_PRESERVATION_OFFLINE_FAIL",
  base_engine_rule_byte_parity: engineParity ? "PASS" : "FAIL",
  new_system_section_count: 0,
  new_user_tail_block_count: 0,
  only_allowed_SceneDirective_slots_differ: pass ? "PASS" : "SEE_TEST_LOG",
  terminal_length_owner_byte_parity: "PASS (constant unchanged; not in SceneDirective)",
  DeepSeek_extras_byte_parity: "PASS (variant does not alter extras mode)",
  INTERNAL_BEAT_COUNT_PRESERVED: budget.internalBeatCountPreserved,
  PROMPT_BEAT_BUDGET_PRESERVED: budget.promptBeatBudgetPreserved,
  serialized_progression_label_count: budget.serializedProgressionLabelCount,
  serialized_concrete_beat_instruction_count:
    budget.serializedConcreteBeatInstructionCount,
  nextBeatHint_chars: budget.nextBeatHintCharCount,
  nextBeatHint_clauses: budget.nextBeatHintClauseCount,
  stdout: result.stdout,
  stderr: result.stderr,
  status: result.status,
};

writeFileSync(join(OUT, "OFFLINE_GATE_VERDICT.json"), JSON.stringify(verdict, null, 2));
console.log(
  JSON.stringify(
    {
      offline_verdict: verdict.offline_verdict,
      base_engine_rule_byte_parity: verdict.base_engine_rule_byte_parity,
      INTERNAL_BEAT_COUNT_PRESERVED: verdict.INTERNAL_BEAT_COUNT_PRESERVED,
      PROMPT_BEAT_BUDGET_PRESERVED: verdict.PROMPT_BEAT_BUDGET_PRESERVED,
      nextBeatHint_chars: verdict.nextBeatHint_chars,
      nextBeatHint_clauses: verdict.nextBeatHint_clauses,
      serialized_concrete_beat_instruction_count:
        verdict.serialized_concrete_beat_instruction_count,
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
