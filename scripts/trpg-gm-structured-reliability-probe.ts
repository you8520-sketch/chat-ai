/**
 * GM structured-output reliability gate — 6 single provider calls (retry=0).
 * 2× SPARSE, 2× MIXED, 2× RICH fixtures via real TRPG_GM_SYSTEM/user blocks.
 *
 * Usage:
 *   TRPG_STRUCTURED_PROBE_OUT_DIR=$PWD/tmp/trpg-gm-structured-reliability \
 *     node --conditions=react-server --import tsx scripts/trpg-gm-structured-reliability-probe.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { callTrpgGm } from "../src/lib/trpg/gmCall";
import {
  assessGmCompletionIntegrity,
  completionIntegrityStatusLabel,
} from "../src/lib/trpg/gmCompletionIntegrity";
import {
  computeTrpgGmNarrationBudget,
  countTrpgNarrationChars,
} from "../src/lib/trpg/gmNarrationBudget";
import { buildTrpgGmUserBlock, TRPG_GM_SYSTEM } from "../src/lib/trpg/gmPrompt";
import { isTrpgGmStructuredShape, parseTrpgGmStructuredJson } from "../src/lib/trpg/gmStructuredOutput";
import { TRPG_GM_MODEL } from "../src/lib/trpg/types";

type Fixture = { label: string; bodies: string[] };

const FIXTURES: Fixture[] = [
  { label: "SPARSE-1", bodies: ["문을 연다.", "창가.", "뒤."] },
  { label: "SPARSE-2", bodies: ["복도로 이동.", "등불.", "숨죽."] },
  {
    label: "MIXED-1",
    bodies: ["문을 연다.", "x".repeat(200), "y".repeat(400)],
  },
  {
    label: "MIXED-2",
    bodies: ["앞으로.", "a".repeat(180), "b".repeat(420)],
  },
  {
    label: "RICH-1",
    bodies: ["a".repeat(400), "b".repeat(400), "c".repeat(400)],
  },
  {
    label: "RICH-2",
    bodies: ["d".repeat(420), "e".repeat(420), "f".repeat(420)],
  },
];

function actions(bodies: string[]) {
  return bodies.map((body, idx) => ({
    participantId: idx + 1,
    name: idx === 0 ? "렌" : `동료${idx}`,
    body,
    participantKind: (idx === 0 ? "human" : "ai_character") as const,
    statKey: "str",
    d20: 14,
    finalScore: 16,
    dc: 12,
    tier: "SUCCESS",
  }));
}

async function runFixture(fixture: Fixture, index: number): Promise<Record<string, unknown>> {
  const user = buildTrpgGmUserBlock({
    worldBrief: "폐역",
    memoryBlock: "[TRPG STRUCTURED STATE]",
    opening: false,
    actions: actions(fixture.bodies),
  });
  const budget = computeTrpgGmNarrationBudget(fixture.bodies);
  const started = Date.now();
  const result = await callTrpgGm({ system: TRPG_GM_SYSTEM, user, timeoutMs: 180_000 });
  const parsed = parseTrpgGmStructuredJson(result.text);
  const integrity = assessGmCompletionIntegrity(result.text, { finishReason: result.finishReason });
  const narration =
    isTrpgGmStructuredShape(parsed) && typeof parsed.narration === "string" ? parsed.narration : "";
  return {
    call: index + 1,
    label: fixture.label,
    STRUCTURE_HEALTHY: integrity.ok,
    INTEGRITY_STATUS: completionIntegrityStatusLabel(integrity),
    NARRATION_PRESENT: narration.trim().length > 0,
    DELTA_PRESENT: isTrpgGmStructuredShape(parsed),
    SCHEMA_PARSE: isTrpgGmStructuredShape(parsed),
    FINISH_REASON: result.finishReason ?? null,
    SEMANTIC_DONE: result.semanticDone === true,
    NARRATION_CHARS: countTrpgNarrationChars(narration),
    COMPUTED_MIN: budget.minChars,
    MINIMUM_MET: countTrpgNarrationChars(narration) >= budget.minChars,
    ELAPSED_MS: Date.now() - started,
    MODEL: TRPG_GM_MODEL,
  };
}

async function main(): Promise<void> {
  const outDir = resolve(
    process.env.TRPG_STRUCTURED_PROBE_OUT_DIR ?? join(process.cwd(), "tmp/trpg-gm-structured-reliability")
  );
  mkdirSync(outDir, { recursive: true });
  const results: Record<string, unknown>[] = [];
  for (let i = 0; i < FIXTURES.length; i += 1) {
    const fixture = FIXTURES[i]!;
    console.info(`[reliability] ${fixture.label} (${i + 1}/6)`);
    const row = await runFixture(fixture, i);
    results.push(row);
    console.info(JSON.stringify(row, null, 2));
  }
  writeFileSync(join(outDir, "reliability-gate.json"), JSON.stringify(results, null, 2));
  const healthy = results.filter((r) => r.STRUCTURE_HEALTHY === true).length;
  console.info(`STRUCTURE_HEALTHY=${healthy}/6`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
