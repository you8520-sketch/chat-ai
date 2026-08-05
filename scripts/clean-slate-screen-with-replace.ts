/**
 * Clean-slate screening: 2 chats × Turn1-2 with replacement only for
 * empty / finish=null transport failures (not for finish=stop shorts).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const OUT = process.env.OUT_DIR;
if (!OUT) throw new Error("OUT_DIR required");

const MAX_ATTEMPTS = 8;
let completedRuns = 0;
let attempt = 0;
const runtimeEvents: unknown[] = [];

function okTurn(metricsPath: string, rawPath: string): boolean {
  if (!existsSync(rawPath) || !existsSync(metricsPath)) return false;
  const raw = readFileSync(rawPath, "utf8");
  if (!raw.trim()) return false;
  const m = JSON.parse(readFileSync(metricsPath, "utf8")) as {
    invalid?: boolean;
    api?: { finish_reason?: string | null };
  };
  if (m.invalid) return false;
  // Exclude only finish=null truncations (and empty already handled)
  if (m.api?.finish_reason == null) return false;
  return true;
}

while (completedRuns < 2 && attempt < MAX_ATTEMPTS) {
  attempt += 1;
  const startRun = completedRuns + 1;
  // Harness loop is `for (run = START_RUN; run <= RUNS; run++)` — set both equal.
  const env = {
    ...process.env,
    RUNS: String(startRun),
    START_RUN: String(startRun),
  };
  const r = spawnSync("node", ["--import", "tsx", "scripts/deepseek-common-root-audit.ts"], {
    env,
    encoding: "utf8",
  });
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");

  const runDir = join(OUT, `run${startRun}`);
  const t1 = join(runDir, "turn1-provider-raw.txt");
  const t2 = join(runDir, "turn2-provider-raw.txt");
  const t1m = join(runDir, "turn1-metrics.json");
  const t2m = join(runDir, "turn2-metrics.json");
  const inv = join(runDir, "turn2-INVALID_RUN.json");

  if (okTurn(t1m, t1) && okTurn(t2m, t2)) {
    completedRuns += 1;
    console.log("COMPLETED_RUN", startRun);
    continue;
  }

  const arch = join(OUT, "..", "runtime_excluded", `attempt${attempt}_run${startRun}`);
  mkdirSync(arch, { recursive: true });
  if (existsSync(runDir)) {
    cpSync(runDir, join(arch, `run${startRun}`), { recursive: true });
  }
  runtimeEvents.push({
    attempt,
    run: startRun,
    exit: r.status,
    reason: existsSync(inv)
      ? "empty_or_invalid_turn2"
      : !existsSync(t2)
        ? "missing_turn2_or_harness_crash"
        : "trunc_or_invalid",
  });
  if (existsSync(runDir)) rmSync(runDir, { recursive: true, force: true });
  console.log("REPLACED_RUN", startRun, "attempt", attempt);
}

writeFileSync(
  join(OUT, "..", "RUNTIME_EVENTS.json"),
  JSON.stringify(runtimeEvents, null, 2),
  "utf8"
);

if (completedRuns < 2) {
  console.error("FAILED_TO_COMPLETE", { completedRuns, attempt, runtimeEvents });
  process.exit(1);
}
console.log("SCREEN_DONE", { completedRuns, attempt, replacements: runtimeEvents.length });
