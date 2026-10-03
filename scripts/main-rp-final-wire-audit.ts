/**
 * Offline Main RP final-wire inventory writer.
 *
 * Does not call a model provider. Do not point this at production chats.
 * Run: node --conditions=react-server --import tsx scripts/main-rp-final-wire-audit.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { runMainRpFinalWireAudit } from "@/lib/mainRpFinalWireAudit";

const outPath = "docs/audits/main-rp-final-wire-inventory-2026-10-02.json";
const report = runMainRpFinalWireAudit();
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const lines = report.cases.map((entry) => {
  const tokens = entry.localEstimateTokens;
  return [
    entry.id,
    entry.wire.model,
    entry.transport,
    `rules=${tokens.cacheRules}`,
    `character=${tokens.cacheCharacter}`,
    `dynamic=${tokens.dynamic}`,
    `user=${tokens.userTurn}`,
    `pacingInCache=${entry.wire.scenePacingInsideCachedCharacterBlock}`,
    `historyCache=${entry.wire.historyCacheBreakpoint}`,
    `heuristicDupUpper=${entry.heuristicDuplicateUpperBound}`,
  ].join("\t");
});
console.log(lines.join("\n"));
console.log(`wrote ${outPath}`);
