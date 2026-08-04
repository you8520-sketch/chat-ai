import { readFileSync } from "node:fs";
import { sanitizeHairDescriptions } from "../src/lib/bodyHairRules";
import { computeDialogueMetrics } from "../src/lib/dialogueMetrics";

const restrictive = { charGender: "male" as const, allowsBeard: false, allowsBodyHair: false };
const permissive = { charGender: "male" as const, allowsBeard: true, allowsBodyHair: true };

for (const t of [1, 2]) {
  const p = JSON.parse(
    readFileSync(
      `/opt/cursor/artifacts/deepseek-common-root-audit/12-v2-stage-audit/ds_pipeline_baseline/run1/turn${t}-pipeline.json`,
      "utf8"
    )
  );
  const A = p.pipeline.provider_raw_merged;
  const afterRestrictive = sanitizeHairDescriptions(A, restrictive);
  const afterPermissive = sanitizeHairDescriptions(A, permissive);
  const mA = computeDialogueMetrics({ text: A });
  const mR = computeDialogueMetrics({ text: afterRestrictive });
  const mP = computeDialogueMetrics({ text: afterPermissive });
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  console.log(`turn ${t}`);
  console.log(`  A (raw):                          paras=${mA.paragraph_count} quotes=${mA.raw_quote_blocks} chars=${A.length}`);
  console.log(`  after restrictive policy:         paras=${mR.paragraph_count} quotes=${mR.raw_quote_blocks} chars=${afterRestrictive.length}`);
  console.log(`  after permissive policy:          paras=${mP.paragraph_count} quotes=${mP.raw_quote_blocks} chars=${afterPermissive.length}`);
  console.log(`  restrictive whitespace-identical: ${norm(A) === norm(afterRestrictive)}`);
  console.log(`  restrictive chars dropped:        ${A.length - afterRestrictive.length}`);
  console.log(`  permissive unchanged:             ${A === afterPermissive}`);
}
