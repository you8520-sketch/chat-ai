import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateExperimentAFixtureProvenance,
  verifyCommittedExperimentASourceRaw,
} from "../src/lib/deepseekAdultHandoffExperimentAProvenance";
import { DEEPSEEK_HANDOFF_TURN_OWNERSHIP } from "../src/lib/deepseekAdultHandoffTurnOwnership";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs/audits/deepseek-0813-turn-ownership-t1");

function main(): void {
  const provenance = evaluateExperimentAFixtureProvenance();
  const sourceRaw = verifyCommittedExperimentASourceRaw(ROOT);
  if (provenance.PRIMARY_LIVE_CALLS !== 0) {
    throw new Error("PRIMARY_LIVE_CALLS must stay 0 while provenance is incomplete");
  }
  const payload = {
    TRACK: "TURN_OWNERSHIP_T1",
    PRIMARY_FIXTURE_PROVEN: provenance.PRIMARY_FIXTURE_PROVEN,
    PRIMARY_LIVE_CALLS: provenance.PRIMARY_LIVE_CALLS,
    BASELINE_CALLS: 0,
    CHALLENGER_CALLS: 0,
    ANTI_PASSIVITY_CALLS: provenance.ANTI_PASSIVITY_CALLS,
    TOTAL_NEW_CALLS: provenance.TOTAL_NEW_CALLS,
    REASON: provenance.reason,
    TARGET: "deepseek-v4-pro-0813",
    TRUE_OFF: "thinking.disabled + reasoning_effort.none",
    SOURCE_MIRROR: false,
    COMPLETION: false,
    ORIGIN_POINTER: false,
    PRODUCTION_CHANGED: false,
    MAIN_MERGED: false,
    RAILWAY_DEPLOYED: false,
    QUALITY_SCORING_BY_CURSOR: false,
    candidate_header: "[DEEPSEEK HANDOFF — TURN OWNERSHIP]",
    candidate_chars: DEEPSEEK_HANDOFF_TURN_OWNERSHIP.length,
    source_raw: sourceRaw,
    fields: provenance.fields,
    notes: provenance.notes,
    experimentAQuality: provenance.experimentAQuality,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, "PROVENANCE.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(
    [
      "DEEPSEEK0813_TURN_OWNERSHIP_T1_CAPTURE_COMPLETE",
      `PRIMARY_FIXTURE_PROVEN=${String(provenance.PRIMARY_FIXTURE_PROVEN)}`,
      `PRIMARY_LIVE_CALLS=${String(provenance.PRIMARY_LIVE_CALLS)}`,
      `TOTAL_NEW_CALLS=${String(provenance.TOTAL_NEW_CALLS)}`,
      `REASON=${provenance.reason}`,
      "PRODUCTION_CHANGED=false",
      "STOP",
      "",
    ].join("\n")
  );
}

main();
