/**
 * Minimal Opus 5.5 CI reasoning + cache contract probe.
 *
 *   node --conditions=react-server --import tsx scripts/diagnose-opus55-contract-probe.ts
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import fs from "node:fs";
import path from "node:path";
import { runOpus55ProviderContractProbe } from "../src/lib/opus55ProviderContractProbe";

const OUT = path.join("/opt/cursor/artifacts", "opus55_runtime_contract_probe.json");

async function main() {
  const result = await runOpus55ProviderContractProbe();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
