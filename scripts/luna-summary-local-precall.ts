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

import { writeLunaExecuteStopReport } from "../src/lib/memory/memory50TurnLunaSummaryExecute.ts";
import {
  LUNA_SUMMARY_PRECALL_REPORT_FILENAME,
  formatLunaPrecallStdout,
  runLunaSummaryLocalPrecall,
} from "../src/lib/memory/memory50TurnLunaSummaryPrecall.ts";

async function main(): Promise<void> {
  const report = await runLunaSummaryLocalPrecall();
  if (!report.cloudAgent && report.journalDirectory && report.journalDirectoryExists) {
    writeLunaExecuteStopReport({
      report,
      preferredDirectory: report.journalDirectory,
      journalDirectory: report.journalDirectory,
      filename: LUNA_SUMMARY_PRECALL_REPORT_FILENAME,
      mkdirPreferred: false,
    });
  }
  console.log(formatLunaPrecallStdout(report));
  process.exitCode = report.verdict === "READY_FOR_APPROVAL" ? 0 : 1;
}

void main();
