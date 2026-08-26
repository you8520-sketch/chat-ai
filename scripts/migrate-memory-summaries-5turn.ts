/**
 * Phase A admin worker: dry-run (default) or apply 6→5 rolling-summary rebuild.
 *
 *   npx tsx scripts/migrate-memory-summaries-5turn.ts
 *   npx tsx scripts/migrate-memory-summaries-5turn.ts --apply --chat-id 123
 *
 * Dry-run: DB mutation 0, provider call 0.
 * Apply is an explicit second step and is never run from panel/backfill.
 */
import "./lib/server-only-mock";
import { getDb } from "../src/lib/db";
import {
  dryRunMemorySummaryMigration,
  runMemorySummaryMigrationPass,
} from "../src/lib/memory/memory-summary-migration";

function parseArgs(argv: string[]): {
  apply: boolean;
  chatIds: number[];
  concurrency?: number;
} {
  const apply = argv.includes("--apply");
  const chatIds: number[] = [];
  let concurrency: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--chat-id" && argv[i + 1]) {
      const id = Number(argv[++i]);
      if (Number.isFinite(id)) chatIds.push(Math.trunc(id));
    } else if (arg === "--concurrency" && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n)) concurrency = Math.trunc(n);
    }
  }
  return { apply, chatIds, concurrency };
}

async function main(): Promise<void> {
  const { apply, chatIds, concurrency } = parseArgs(process.argv.slice(2));
  getDb();
  if (!apply) {
    const report = dryRunMemorySummaryMigration();
    console.log(JSON.stringify({ mode: "dry-run", ...report }, null, 2));
    return;
  }
  const result = await runMemorySummaryMigrationPass({
    dryRun: false,
    chatIds: chatIds.length ? chatIds : undefined,
    concurrency,
  });
  console.log(JSON.stringify({ mode: "apply", ...result }, null, 2));
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
