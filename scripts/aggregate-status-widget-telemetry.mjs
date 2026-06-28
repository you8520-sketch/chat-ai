/**
 * Aggregate [status-widget-telemetry] lines from dev logs or tmp/status-widget-telemetry.jsonl
 *
 * Usage:
 *   node scripts/aggregate-status-widget-telemetry.mjs
 *   node scripts/aggregate-status-widget-telemetry.mjs path/to/server.log
 *   STATUS_WIDGET_TELEMETRY_LOG=1 npm run dev  # writes tmp/status-widget-telemetry.jsonl
 */

import fs from "node:fs";
import path from "node:path";

const PREFIX = "[status-widget-telemetry] ";
const defaultJsonl = path.join(process.cwd(), "tmp", "status-widget-telemetry.jsonl");

function parseLines(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(PREFIX);
    if (idx < 0) continue;
    try {
      rows.push(JSON.parse(line.slice(idx + PREFIX.length).trim()));
    } catch {
      // skip
    }
  }
  return rows;
}

function aggregate(rows) {
  const total = rows.length;
  const byFamily = {};
  const bySource = {};
  let jsonOk = 0;
  let infer = 0;
  let backfillAttempt = 0;
  let backfillOk = 0;
  let finalOk = 0;

  for (const r of rows) {
    if (r.jsonParseSuccess) jsonOk++;
    if (r.inferHit) infer++;
    if (r.backfillAttempted) backfillAttempt++;
    if (r.backfillSuccess) backfillOk++;
    if (r.finalHasContent) finalOk++;

    const fam = r.modelFamily ?? "unknown";
    if (!byFamily[fam]) {
      byFamily[fam] = {
        turns: 0,
        jsonParseSuccessRate: 0,
        inferRate: 0,
        backfillAttemptRate: 0,
        backfillSuccessRate: 0,
        finalHasContentRate: 0,
      };
    }
    const b = byFamily[fam];
    b.turns++;
    if (r.jsonParseSuccess) b.jsonParseSuccessRate++;
    if (r.inferHit) b.inferRate++;
    if (r.backfillAttempted) b.backfillAttemptRate++;
    if (r.backfillSuccess) b.backfillSuccessRate++;
    if (r.finalHasContent) b.finalHasContentRate++;

    const src = r.resolutionSource ?? "none";
    bySource[src] = (bySource[src] ?? 0) + 1;
  }

  for (const b of Object.values(byFamily)) {
    const n = b.turns;
    if (n > 0) {
      b.jsonParseSuccessRate /= n;
      b.inferRate /= n;
      b.backfillAttemptRate /= n;
      b.backfillSuccessRate /= n;
      b.finalHasContentRate /= n;
    }
  }

  const pct = (n) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "n/a");

  return {
    totalTurns: total,
    rates: {
      jsonParseSuccess: pct(jsonOk),
      inferWidgetValuesFromProse: pct(infer),
      backfillAttempt: pct(backfillAttempt),
      backfillSuccess: pct(backfillOk),
      finalHasContent: pct(finalOk),
    },
    byModelFamily: byFamily,
    byResolutionSource: bySource,
  };
}

const inputPath = process.argv[2] ?? defaultJsonl;
let text = "";
if (fs.existsSync(inputPath)) {
  text = fs.readFileSync(inputPath, "utf8");
} else {
  console.warn(`No file at ${inputPath} — pass a log path or set STATUS_WIDGET_TELEMETRY_LOG=1 during chat tests.`);
  process.exit(0);
}

const rows = parseLines(text);
const report = aggregate(rows);
console.log(JSON.stringify(report, null, 2));

if (report.totalTurns === 0) {
  console.log("\nNo telemetry rows found. Look for lines starting with:", PREFIX);
}
