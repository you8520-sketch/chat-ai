import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { runLunaSummaryLocalPrecall } from "../src/lib/memory/memory50TurnLunaSummaryPrecall.ts";

async function main(): Promise<void> {
  const report = await runLunaSummaryLocalPrecall();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.LIVE_PRECALL_READY ? 0 : 1;
}

void main();
