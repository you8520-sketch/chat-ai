import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/opt/cursor/artifacts/deepseek-common-root-audit";
const d2a = JSON.parse(readFileSync(join(ROOT, "00-integrity/D2A_VERDICT.json"), "utf8")) as {
  verdict?: string;
};
if (d2a.verdict === "DEEPSEEK_PRO_SPECIFIC_LAYER_CONFIRMED") process.exit(1);
process.exit(0);
