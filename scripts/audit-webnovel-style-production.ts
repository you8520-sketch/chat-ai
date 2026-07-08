/**
 * Production webnovel style audit — 40–80 DeepSeek assistant samples from DB.
 * Read-only; no prompt/rule/production changes.
 *
 * Usage:
 *   npx tsx scripts/audit-webnovel-style-production.ts
 *   npx tsx scripts/audit-webnovel-style-production.ts --samples=60
 *   npx tsx scripts/audit-webnovel-style-production.ts --db=path/to/app.db
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "../src/lib/chatModels";
import {
  WEBNOVEL_STYLE_DIMENSIONS,
  auditWebnovelStyleText,
  summarizeCorpus,
  type WebnovelStyleAuditResult,
} from "./lib/webnovel-style-audit";
import { collectStyleAuditSamples } from "./lib/collect-style-audit-samples";

function parseSamplesArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--samples="));
  const n = arg ? Number.parseInt(arg.split("=")[1] ?? "", 10) : 60;
  if (!Number.isFinite(n)) return 60;
  return Math.max(40, Math.min(80, n));
}

function parseDbArg(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith("--db="));
  return arg ? arg.split("=")[1] : undefined;
}

function buildSummaryText(
  results: WebnovelStyleAuditResult[],
  summary: ReturnType<typeof summarizeCorpus>,
  sampleNote: string
): string {
  const lines: string[] = [
    "Step 2 — Production Webnovel Style Audit",
    "=".repeat(72),
    sampleNote,
    `Samples: ${results.length} (target 40–80, DeepSeek production turns)`,
    `Overall mean: ${(results.reduce((s, r) => s + r.overallScore, 0) / results.length).toFixed(1)} / 10`,
    "",
    "── Dimension scores (0–10, higher = better) ──",
  ];

  for (const dim of WEBNOVEL_STYLE_DIMENSIONS) {
    const mean = summary.dimensionMeans[dim.id];
    const worst = summary.dimensionWorstSamples[dim.id];
    lines.push(
      "",
      `[${dim.labelKo}] mean=${mean.toFixed(1)}`,
      `  worst sample: msg#${worst.messageId} score=${worst.score}`,
      `  rationale: ${worst.rationale}`,
      `  example: ${worst.evidenceSnippet.slice(0, 200)}${worst.evidenceSnippet.length > 200 ? "…" : ""}`
    );
  }

  lines.push("", "── Step 2 follow-up bottlenecks (top 2–3) ──");
  for (let i = 0; i < summary.bottlenecks.length; i++) {
    const b = summary.bottlenecks[i]!;
    lines.push(
      "",
      `${i + 1}. ${b.labelKo} — mean ${b.meanScore}/10, impact=${b.impactScore}`,
      `   ${b.whyBottleneck}`
    );
  }

  lines.push(
    "",
    "Note: Audit-only; no new PROSE rules applied. hand/touch metrics included for baseline comparison."
  );
  return lines.join("\n");
}

function main() {
  const sampleTarget = parseSamplesArg();
  const dbOverride = parseDbArg();
  const { samples: collected, sources } = collectStyleAuditSamples({
    target: sampleTarget,
    dbPaths: dbOverride ? [dbOverride] : undefined,
  });

  if (collected.length < 40) {
    console.warn(
      `Warning: ${collected.length} unique samples (target 40–80). DB=${sources.db}, harness=${sources.harness}`
    );
  }

  const results: WebnovelStyleAuditResult[] = collected.map((row) =>
    auditWebnovelStyleText(row.text, {
      messageId: row.messageId ?? 0,
      chatId: row.chatId ?? 0,
    })
  );

  const summary = summarizeCorpus(results);
  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });

  const jsonPath = join(outDir, "webnovel-style-production-audit.json");
  const txtPath = join(outDir, "webnovel-style-production-audit-summary.txt");

  const sampleNote = `Sources: DB chats=${sources.db}, production-harness validation=${sources.harness} | deduped=${results.length}`;
  const payload = {
    audit: "webnovel-style-production",
    step: "Step 2 scope expansion (audit-only)",
    modelFilter: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    sampleSources: sources,
    sampleCount: results.length,
    overallMean:
      Math.round((results.reduce((s, r) => s + r.overallScore, 0) / results.length) * 10) / 10,
    dimensionMeans: summary.dimensionMeans,
    dimensionWorstSamples: summary.dimensionWorstSamples,
    step2FollowUpBottlenecks: summary.bottlenecks,
    samples: results.map((r, i) => ({
      sampleId: collected[i]?.id,
      sampleSource: collected[i]?.source,
      messageId: r.messageId,
      chatId: r.chatId,
      charCount: r.charCount,
      overallScore: r.overallScore,
      dimensionScores: r.dimensionScores,
      raw: r.raw,
    })),
  };

  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(txtPath, buildSummaryText(results, summary, sampleNote), "utf8");

  console.log("=== Webnovel Style Production Audit ===");
  console.log(`Samples: ${results.length} | Overall mean: ${payload.overallMean}/10`);
  console.log("\nDimension means:");
  for (const dim of WEBNOVEL_STYLE_DIMENSIONS) {
    console.log(`  ${dim.labelKo}: ${summary.dimensionMeans[dim.id].toFixed(1)}`);
  }
  console.log("\nStep 2 follow-up bottlenecks:");
  for (const b of summary.bottlenecks) {
    console.log(`  • ${b.labelKo} (${b.meanScore}/10, impact ${b.impactScore})`);
  }
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${txtPath}`);
}

main();
