import fs from "node:fs";

import { summarizeR5BoundarySuspicionSignals } from "@/lib/scenePolicyBoundarySuspicionScan";

const path = "data/scene-policy-pilot/r5-variance-pilot-result.json";
const pilot = JSON.parse(fs.readFileSync(path, "utf8")) as {
  captures: Array<{ logical_id: string; raw_output: string | null }>;
  suspicionSummary?: unknown;
  violationSummary?: unknown;
};

const suspicionSummary = summarizeR5BoundarySuspicionSignals(pilot.captures);
pilot.suspicionSummary = suspicionSummary;
pilot.violationSummary = {
  totalSamples: suspicionSummary.totalSamples,
  violationCounts: suspicionSummary.suspicionSignalCounts,
  samplesWithAnyViolation: suspicionSummary.samplesWithAnySuspicionSignal,
  perSample: suspicionSummary.perSample.map((row) => ({
    logical_id: row.logical_id,
    violations: row.suspicionSignals,
  })),
  _deprecated: "Use suspicionSummary — lexical triage only, not behavior violations",
};

fs.writeFileSync(path, `${JSON.stringify(pilot, null, 2)}\n`);
console.log(JSON.stringify(suspicionSummary, null, 2));
