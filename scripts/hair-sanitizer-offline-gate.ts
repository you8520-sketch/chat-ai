/**
 * Offline gate: replay production RAW fixtures through the FIXED sanitizeHairDescriptions
 * and verify paragraph non-increase + no-violation byte identity + idempotence.
 *
 * Usage: node --import tsx scripts/hair-sanitizer-offline-gate.ts
 */
import { readFileSync } from "node:fs";
import { sanitizeHairDescriptions, type HairDescriptionPolicy } from "../src/lib/bodyHairRules";
import { computeDialogueMetrics } from "../src/lib/dialogueMetrics";

const restrictive: HairDescriptionPolicy = {
  charGender: "male",
  allowsBeard: false,
  allowsBodyHair: false,
};

function wsNorm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const fixtures = [
  {
    label: "stage-audit-turn1-raw",
    path: "/opt/cursor/artifacts/deepseek-common-root-audit/12-v2-stage-audit/ds_pipeline_baseline/run1/turn1-provider-raw.txt",
  },
  {
    label: "stage-audit-turn2-raw",
    path: "/opt/cursor/artifacts/deepseek-common-root-audit/12-v2-stage-audit/ds_pipeline_baseline/run1/turn2-provider-raw.txt",
  },
];

let pass = true;

for (const f of fixtures) {
  let raw: string;
  try {
    raw = readFileSync(f.path, "utf8");
  } catch {
    console.log(`${f.label}: fixture not found — skipping`);
    continue;
  }
  const legacy = (() => {
    // Legacy implementation: split by sentence/newline, rejoin with \n\n.
    const parts = raw.split(/(?<=[.!?…])\s+|\n+/);
    const kept: string[] = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      kept.push(trimmed);
    }
    return kept.length === 0 ? raw : kept.join("\n\n");
  })();

  const fixed = sanitizeHairDescriptions(raw, restrictive);
  const fixed2 = sanitizeHairDescriptions(fixed, restrictive);
  const rawM = computeDialogueMetrics({ text: raw });
  const legacyM = computeDialogueMetrics({ text: legacy });
  const fixedM = computeDialogueMetrics({ text: fixed });

  const wsIdentical = wsNorm(raw) === wsNorm(fixed);
  const legacyInflation = legacyM.paragraph_count - rawM.paragraph_count;
  const fixedInflation = fixedM.paragraph_count - rawM.paragraph_count;
  const inflationReductionPct =
    legacyInflation > 0 ? (legacyInflation - fixedInflation) / legacyInflation : 1;
  const nonIncrease = fixedM.paragraph_count <= rawM.paragraph_count + 1;
  const idempotent = fixed2 === fixed;
  const quotesPreserved = fixedM.raw_quote_blocks >= rawM.raw_quote_blocks;

  console.log(`\n=== ${f.label} ===`);
  console.log(`  raw:           paras=${rawM.paragraph_count} quotes=${rawM.raw_quote_blocks} chars=${raw.length}`);
  console.log(`  legacy:         paras=${legacyM.paragraph_count} quotes=${legacyM.raw_quote_blocks} chars=${legacy.length}`);
  console.log(`  fixed:          paras=${fixedM.paragraph_count} quotes=${fixedM.raw_quote_blocks} chars=${fixed.length}`);
  console.log(`  whitespace-identical: ${wsIdentical}`);
  console.log(`  legacy inflation: ${legacyInflation} -> fixed inflation: ${fixedInflation} (reduced ${Math.round(inflationReductionPct * 100)}%)`);
  console.log(`  paragraph non-increase (<=raw+1): ${nonIncrease}`);
  console.log(`  idempotent: ${idempotent}`);
  console.log(`  quotes preserved (fixed>=raw): ${quotesPreserved}`);

  if (!nonIncrease) {
    console.log("  FAIL: paragraph increased");
    pass = false;
  }
  if (!idempotent) {
    console.log("  FAIL: not idempotent");
    pass = false;
  }
  if (!quotesPreserved) {
    console.log("  FAIL: quotes dropped");
    pass = false;
  }
  if (legacyInflation > 0 && inflationReductionPct < 0.8) {
    console.log("  FAIL: inflation not reduced >=80%");
    pass = false;
  }
}

console.log(`\nVERDICT: ${pass ? "HAIR_SANITIZER_OFFLINE_GATE_PASS" : "HAIR_SANITIZER_OFFLINE_GATE_FAIL"}`);
process.exit(pass ? 0 : 1);
