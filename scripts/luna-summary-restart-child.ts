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

import { runAuthorizedLunaSummaryExperiment } from "../src/lib/memory/memory50TurnLunaSummaryExecute.ts";

async function main(): Promise<void> {
  const directory = process.argv[2];
  if (!directory) {
    process.stdout.write("MISSING_ARGS");
    process.exit(2);
  }

  const result = await runAuthorizedLunaSummaryExperiment({
    userCostApproved: true,
    experimentKey: "luna-experiment-only-not-production",
    env: {},
    journalDirectory: directory,
    completion: async () => {
      process.stdout.write("POST");
      return {
        text: "x",
        usage: { inputTokens: 1, outputTokens: 1, estimated: true },
      };
    },
  });
  process.stdout.write(result.abortReason ?? "RAN");
}

void main();
