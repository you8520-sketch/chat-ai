/**
 * Offline gate for dense-internal SHORT HISTORY sustain re-substitution.
 * Run: node --import tsx scripts/ds-short-history-dense-offline-gate.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA,
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL,
  DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_INTERNAL,
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_DENSE_INTERNAL,
  DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_INTERNAL,
  resolveDeepSeekShortHistoryLengthExtra,
} from "../src/lib/deepseekPromptStructure";

const OUT =
  process.env.OUT_DIR ??
  "/opt/cursor/artifacts/deepseek-common-root-audit/32-short-history-dense-internal";

mkdirSync(OUT, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    "--conditions=react-server",
    "--import",
    "tsx",
    "--test",
    "src/lib/deepseekShortHistoryDense.offline.test.ts",
  ],
  { cwd: process.cwd(), encoding: "utf8" }
);

function sha16(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

const HEADER =
  "[SHORT HISTORY]\n" +
  "Recent assistant length is context, not a response-length example. ";
const SECOND =
  "In this single response, develop a full scene of roughly normal requested length even with sparse history. ";

const prod = resolveDeepSeekShortHistoryLengthExtra([])!;
const pr241 = DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_INTERNAL;
const dense = resolveDeepSeekShortHistoryLengthExtra([], {
  denseInternalSustain: true,
})!;

const clause = DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_DENSE_INTERNAL;
const externalCueCount = [
  /\bNPC\b/i,
  /new character/i,
  /outside world/i,
  /world reaction/i,
  /\bstaff\b/i,
  /\bguard\b/i,
  /registration/i,
  /inspection/i,
  /\breport\b/i,
  /\bcall\b/i,
  /\benvironment\b/,
].filter((re) => re.test(clause)).length;

const internalDensity = {
  interpretation: /specific interpretation/i.test(clause) ? 1 : 0,
  primary_choice_action:
    (/consequential primary-character choices/i.test(clause) ? 1 : 0) +
    (/concrete action/i.test(clause) ? 1 : 0),
  existing_scene_change: /observable change within the existing scene/i.test(clause)
    ? 1
    : 0,
  relationship: /relationship development/i.test(clause) ? 1 : 0,
  inner_experience: /necessary inner experience/i.test(clause) ? 1 : 0,
  open_reaction: /concrete opening for the user's response/i.test(clause) ? 1 : 0,
};

const headerParity = dense.startsWith(HEADER) && pr241.startsWith(HEADER);
const firstSentenceParity =
  dense.includes(
    "Recent assistant length is context, not a response-length example."
  ) &&
  pr241.includes(
    "Recent assistant length is context, not a response-length example."
  );
const secondSentenceParity = dense.includes(SECOND.trim()) && pr241.includes(SECOND.trim());
const onlySustainDiffers =
  pr241.replace(DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_INTERNAL, "") ===
  dense.replace(DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_DENSE_INTERNAL, "");

const pass =
  result.status === 0 &&
  prod === DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA &&
  dense === DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL &&
  headerParity &&
  firstSentenceParity &&
  secondSentenceParity &&
  onlySustainDiffers &&
  externalCueCount === 0 &&
  internalDensity.interpretation >= 1 &&
  internalDensity.primary_choice_action >= 2 &&
  internalDensity.existing_scene_change >= 1 &&
  internalDensity.relationship >= 1 &&
  internalDensity.inner_experience >= 1 &&
  internalDensity.open_reaction >= 1;

const verdict = {
  offline_verdict: pass
    ? "DS_SHORT_HISTORY_DENSE_INTERNAL_OFFLINE_PASS"
    : "DS_SHORT_HISTORY_DENSE_INTERNAL_OFFLINE_FAIL",
  selected_block_id: "DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA_DENSE_INTERNAL",
  exact_sustain_clause: clause,
  pr241_sustain_clause: DEEPSEEK_SHORT_HISTORY_SUSTAIN_CLAUSE_INTERNAL,
  production_short_history_hash: sha16(prod),
  pr241_short_history_hash: sha16(pr241),
  dense_short_history_hash: sha16(dense),
  header_parity: headerParity ? "PASS" : "FAIL",
  first_sentence_parity: firstSentenceParity ? "PASS" : "FAIL",
  second_sentence_parity: secondSentenceParity ? "PASS" : "FAIL",
  only_clause_diff: onlySustainDiffers ? "PASS" : "FAIL",
  external_cue_count: externalCueCount,
  internal_density: internalDensity,
  internal_density_cue_count: Object.values(internalDensity).reduce((a, b) => a + b, 0),
  stdout: result.stdout,
  stderr: result.stderr,
  status: result.status,
};

writeFileSync(join(OUT, "OFFLINE_GATE_VERDICT.json"), JSON.stringify(verdict, null, 2));
console.log(
  JSON.stringify(
    {
      offline_verdict: verdict.offline_verdict,
      only_clause_diff: verdict.only_clause_diff,
      external_cue_count: verdict.external_cue_count,
      internal_density_cue_count: verdict.internal_density_cue_count,
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
