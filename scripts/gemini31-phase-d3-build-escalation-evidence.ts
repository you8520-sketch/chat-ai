/**
 * Phase D.3 — freeze escalation evidence from existing artifacts.
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-d3-build-escalation-evidence.ts
 */
import fs from "node:fs";
import path from "node:path";

import { buildEscalationEvidence } from "./lib/gemini31PhaseD3Evidence";

const OUT_ARTIFACT = "/opt/cursor/artifacts/gemini31-phase-d3-escalation/evidence.json";
const OUT_DOCS = path.join(
  process.cwd(),
  "docs/audits/gemini31-phase-d3-escalation/evidence.json"
);

function main() {
  const evidence = buildEscalationEvidence({});
  for (const dir of [path.dirname(OUT_ARTIFACT), path.dirname(OUT_DOCS)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(OUT_ARTIFACT, JSON.stringify(evidence, null, 2));
  fs.writeFileSync(OUT_DOCS, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}

main();
