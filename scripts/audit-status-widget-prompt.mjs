/**
 * Status Widget prompt slices — post-dedupe audit + before/after metrics.
 * Run: npx tsx scripts/audit-status-widget-prompt.mjs
 */

import { auditStatusWidgetPromptDuplicates } from "../src/lib/statusWidget/promptDuplicateAudit.ts";
import { compareWidgetActiveDedupe } from "../src/lib/statusWidget/promptDedupeMetrics.ts";

const audit = auditStatusWidgetPromptDuplicates();
const dedupe = compareWidgetActiveDedupe();

console.log("=== Status Widget Prompt Dedupe Report ===\n");

console.log("--- Before / After (widget-active OpenRouter injection) ---");
console.log(`System slices (widget + firewall):`);
console.log(
  `  Before: ${dedupe.before.totalSystemInjectionChars} chars (~${Math.round(
    dedupe.before.totalSystemInjectionChars / 4
  )} tokens est.)`
);
console.log(
  `  After:  ${dedupe.after.totalSystemInjectionChars} chars (~${dedupe.after.estimatedSystemTokens} tokens est.)`
);
console.log(
  `  Saved:  ${dedupe.savedSystemChars} chars (${(dedupe.savedSystemPct * 100).toFixed(1)}%)`
);
console.log(`DeepSeek user-turn tail (widget ON):`);
console.log(`  Before: ${dedupe.before.deepSeekUserTurnExtraChars} chars`);
console.log(`  After:  ${dedupe.after.deepSeekUserTurnExtraChars} chars`);
console.log(
  `  Saved:  ${dedupe.savedDeepSeekUserChars} chars (${(dedupe.savedDeepSeekUserPct * 100).toFixed(1)}%)`
);
console.log(`Per-turn total (system + DeepSeek user tail when applicable):`);
console.log(
  `  Before: ${dedupe.before.totalSystemInjectionChars + dedupe.before.deepSeekUserTurnExtraChars} chars`
);
console.log(
  `  After:  ${dedupe.after.totalSystemInjectionChars + dedupe.after.deepSeekUserTurnExtraChars} chars`
);
console.log(
  `  Saved:  ${dedupe.savedTotalCharsPerTurn} chars (${(dedupe.savedTotalPct * 100).toFixed(1)}%)`
);

console.log("\n--- Post-dedupe slice sizes ---");
for (const [name, slice] of Object.entries(audit.slices)) {
  if (!slice.trim()) continue;
  console.log(`  ${name}: ${slice.length} chars`);
}
console.log(`  Combined audit slices: ${audit.combinedChars} chars`);
console.log(`  Findings: ${audit.findings.length}`);

if (audit.findings.length > 0) {
  console.log("\n--- Remaining overlap notes ---");
  for (const f of audit.findings) {
    console.log(`[${f.severity}] ${f.category}: ${f.note}`);
  }
}
