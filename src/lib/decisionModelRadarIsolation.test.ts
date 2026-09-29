import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

describe("decision model radar isolation", () => {
  it("keeps the production JEV pin and Railway scheduler outside radar ownership", () => {
    const jev = fs.readFileSync("src/lib/jevDecisions.ts", "utf8");
    const workflow = fs.readFileSync(
      ".github/workflows/decision-model-radar-weekly.yml",
      "utf8"
    );
    const scheduler = fs.readFileSync("src/lib/schedulerDefinitions.ts", "utf8");

    assert.match(jev, /JEV_DECISIONS_MODEL\s*=\s*"typesafe\/jev-1\.13"/);
    assert.doesNotMatch(workflow, /schedulerDefinitions|Railway|update_parental|merge_pull_request/);
    assert.doesNotMatch(scheduler, /decision[_-]model[_-]radar/i);
    assert.match(workflow, /decision-model-radar-ledger/);
    assert.match(workflow, /git diff --exit-code -- \. ':!artifacts'/);
  });

  it("requires explicit benchmark opt-in and never auto-switches models", () => {
    const runner = fs.readFileSync("scripts/decision-model-radar.ts", "utf8");
    assert.match(runner, /REGULAR_TEST_REAL_PROVIDER_CALLS/);
    assert.match(runner, /DECISION_MODEL_RADAR_LIVE/);
    assert.match(runner, /runtimeModelPinChanged:\s*false/);
    assert.match(runner, /autoSwitchEnabled:\s*false/);
    assert.doesNotMatch(runner, /JEV_DECISIONS_MODEL\s*=/);
  });
});
