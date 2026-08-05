/**
 * Write offline structural gate verdict for structured scene-focus canary.
 *
 * Run: node --import tsx scripts/structured-scene-focus-offline-gate.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const OUT =
  process.env.OUT_DIR ??
  "/opt/cursor/artifacts/deepseek-common-root-audit/27-structured-scene-focus";

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

const pass = result.status === 0;
const verdict = {
  offline_structural_gate: pass
    ? "STRUCTURED_SCENE_FOCUS_OFFLINE_PASS"
    : "STRUCTURED_SCENE_FOCUS_OFFLINE_FAIL",
  section_count_parity: pass ? "PASS" : "SEE_TEST_LOG",
  role_order_parity: pass ? "PASS (no new section)" : "SEE_TEST_LOG",
  SceneDirective_only_diff: pass ? "PASS" : "SEE_TEST_LOG",
  beat_count_preservation: pass ? "PASS" : "SEE_TEST_LOG",
  resolved_progression_sources: pass
    ? "PRIMARY_* / RELATIONSHIP_MOVEMENT / EXISTING_* (external withheld)"
    : "SEE_TEST_LOG",
  stdout: result.stdout,
  stderr: result.stderr,
  status: result.status,
};

writeFileSync(join(OUT, "OFFLINE_GATE_VERDICT.json"), JSON.stringify(verdict, null, 2));
console.log(JSON.stringify({ offline_structural_gate: verdict.offline_structural_gate }, null, 2));
process.exit(pass ? 0 : 1);
