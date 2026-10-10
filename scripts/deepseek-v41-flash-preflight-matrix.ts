/**
 * Generate V4.1 Flash preflight price matrix JSON.
 * Run: node --conditions=react-server --import tsx scripts/deepseek-v41-flash-preflight-matrix.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildV41FlashCandidatePriceMatrix,
  CI_DEEPSEEK_V41_FLASH_SNAPSHOT,
  CI_DEEPSEEK_V4_FLASH_0731_SNAPSHOT,
  CI_DEEPSEEK_V4_PRO_0813_SNAPSHOT,
  DEEPSEEK_V41_FLASH_DETERMINISTIC_CANDIDATE,
  LEGACY_FLASH_ALIAS_MAP,
  DEAD_SYSTEM_AUDIT,
  REGRESSION_GATES,
} from "@/lib/deepseekV41FlashPreflight";
import { SEMANTICS_AUDIT_FX } from "@/lib/billingPricingSemanticsAudit";

const OUT = join(process.cwd(), "docs/audits/deepseek-v41-flash-preflight-2026-09-20");

mkdirSync(OUT, { recursive: true });

writeFileSync(
  join(OUT, "PRICE_MATRIX.json"),
  JSON.stringify(
    {
      fx: SEMANTICS_AUDIT_FX,
      candidate: DEEPSEEK_V41_FLASH_DETERMINISTIC_CANDIDATE,
      ciSnapshots: {
        v41Flash: CI_DEEPSEEK_V41_FLASH_SNAPSHOT,
        v4Pro0813: CI_DEEPSEEK_V4_PRO_0813_SNAPSHOT,
        legacy0731: CI_DEEPSEEK_V4_FLASH_0731_SNAPSHOT,
      },
      rows: buildV41FlashCandidatePriceMatrix(),
      legacyAliasMap: LEGACY_FLASH_ALIAS_MAP,
      deadSystemAudit: DEAD_SYSTEM_AUDIT,
      regressionGates: REGRESSION_GATES,
    },
    null,
    2
  )
);

console.log(`Wrote ${OUT}/PRICE_MATRIX.json`);
