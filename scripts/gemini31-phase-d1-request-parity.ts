/**
 * Phase D.1 §4 — Request parity inventory (no live API).
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-d1-request-parity.ts
 */
import fs from "node:fs";
import path from "node:path";

import {
  PHASE_D_MINIMAL_SYSTEM,
  PHASE_D_USER_TURNS,
  buildRequestParityInventory,
} from "./lib/gemini31PhaseDProbe";

const OUT = "/opt/cursor/artifacts/gemini31-phase-d1-reasoning/request-parity.json";

async function main() {
  const inventory = buildRequestParityInventory(
    [{ role: "user", content: PHASE_D_USER_TURNS[0]! }],
    PHASE_D_MINIMAL_SYSTEM
  );

  const report = {
    generatedAt: new Date().toISOString(),
    ...inventory,
    NOTE: "First-byte vs first-SSE may differ when upstream buffers; not asserted equal here.",
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
