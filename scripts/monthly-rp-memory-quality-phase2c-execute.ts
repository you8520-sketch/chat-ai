/**
 * One-shot #1486 Phase 2C Luna execute. Do not import regularTestEgressPolicy.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  executePhase2cLunaSummary,
  PHASE2C_LOCK_DIR,
} from "../src/lib/memory/monthlyRpMemoryQualityPhase2cExecute";

const evidencePath = path.join(PHASE2C_LOCK_DIR, "evidence.json");
const repoEvidenceDir = path.join(
  process.cwd(),
  "docs/audits/monthly-rp-memory-quality-phase2c-2026-10-10"
);

async function main(): Promise<void> {
  const result = await executePhase2cLunaSummary();
  mkdirSync(PHASE2C_LOCK_DIR, { recursive: true });
  mkdirSync(repoEvidenceDir, { recursive: true });
  if (!result.ok) {
    const payload = { ok: false, reason: result.reason, evidence: result.evidence ?? null };
    writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    writeFileSync(path.join(repoEvidenceDir, "evidence.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.error(JSON.stringify({ ok: false, reason: result.reason, providerPosts: result.evidence?.providerPosts ?? 0 }));
    process.exitCode = 2;
    return;
  }
  writeFileSync(evidencePath, `${JSON.stringify(result.evidence, null, 2)}\n`, "utf8");
  writeFileSync(
    path.join(repoEvidenceDir, "evidence.json"),
    `${JSON.stringify(result.evidence, null, 2)}\n`,
    "utf8"
  );
  console.log(
    JSON.stringify({
      ok: true,
      provenance: result.evidence.provenance,
      providerPosts: result.evidence.providerPosts,
      selectedChars: result.evidence.selectedSummary.length,
      billedUsd: result.evidence.billedUsd,
    })
  );
}

void main();
