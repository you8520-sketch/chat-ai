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

import { createLunaDurableJournalStore } from "../src/lib/memory/memory50TurnLunaSummaryExecute.ts";

const directory = process.argv[2];
const fingerprint = process.argv[3];
if (!directory || !fingerprint) {
  process.stdout.write("MISSING_ARGS");
  process.exit(2);
}
const store = createLunaDurableJournalStore(directory);
const lock = store.lockStore.tryAcquireExclusiveLock(fingerprint);
if (!lock.ok) {
  process.stdout.write(lock.reason);
  process.exit(0);
}
process.stdout.write("ACQUIRED");
lock.lock.release();
