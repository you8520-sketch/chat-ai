import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/opt/cursor/artifacts/deepseek-common-root-audit";
let d1: { verdict?: string; effect?: { effect_confirmed?: boolean } } | null = null;
try {
  d1 = JSON.parse(readFileSync(join(ROOT, "00-integrity/D1_NPC_VERDICT.json"), "utf8"));
} catch {
  process.exit(1);
}
if (d1?.effect?.effect_confirmed) process.exit(1);
process.exit(0);
