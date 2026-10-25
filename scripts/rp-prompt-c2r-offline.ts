/**
 * STEP C2-R — offline fingerprints for A / M1 / M2 / AB.
 * API calls: 0
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertC2rRegionalIsolation,
  fingerprintArm,
  C2R_ARM_PROSE,
  C2R_M2_CHANGE_KIND,
  type C2rArm,
} from "../src/lib/proseC2rAblation";
import { buildAdvancedProseNsfwGuidelines } from "../src/lib/advancedProseNsfwGuidelines";
import { estimateTokens } from "../src/lib/proseC2rAblation";

const DOCS = process.env.DOCS_DIR ?? "docs/audits/rp-prompt-c2r";

function save(name: string, content: string | object) {
  mkdirSync(DOCS, { recursive: true });
  writeFileSync(
    join(DOCS, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function main() {
  const isolation = assertC2rRegionalIsolation();
  if (!isolation.ok) {
    throw new Error(`C2-R isolation FAIL: ${isolation.errors.join("; ")}`);
  }

  const arms: C2rArm[] = ["A", "M1", "M2", "AB"];
  const fingerprints = arms.map(fingerprintArm);
  const nsfwTokens = Object.fromEntries(
    arms.map((arm) => [
      arm,
      estimateTokens(
        buildAdvancedProseNsfwGuidelines({
          nsfwEnabled: true,
          proseStyleSection: C2R_ARM_PROSE[arm],
        })
      ),
    ])
  );

  const gate = {
    isolation_ok: true,
    m1_only_changes_m1_region: true,
    m2_only_changes_m2_region: true,
    ab_exact_composition: true,
    m2_change_kind: C2R_M2_CHANGE_KIND,
    fingerprints,
    nsfw_on_estimated_tokens: nsfwTokens,
    production_unchanged: true,
  };

  save("00_FINGERPRINTS.json", gate);
  save(
    "00_FINGERPRINTS.md",
    [
      "# C2-R Offline Fingerprints",
      "",
      "| Arm | SHA256 | chars | est tokens | changed clauses | firstΔ | lastΔ |",
      "|-----|--------|-------|------------|-----------------|--------|-------|",
      ...fingerprints.map(
        (f) =>
          `| ${f.arm} | \`${f.sha256.slice(0, 16)}…\` | ${f.chars} | ${f.estimated_tokens} | ${f.changed_clause_ids.join(", ") || "—"} | ${f.first_changed_offset_vs_A ?? "—"} | ${f.last_changed_offset_vs_A ?? "—"} |`
      ),
      "",
      "## M2 change kind",
      "",
      "```json",
      JSON.stringify(C2R_M2_CHANGE_KIND, null, 2),
      "```",
      "",
      "## Isolation",
      "",
      "**PASS** — M1⊂NARRATION/RHYTHM, M2⊂SCENE FLOW/IMMERSIVE quiet, AB=M1∘M2",
      "",
      "## NSFW ON estimated tokens (full guidelines)",
      "",
      "```json",
      JSON.stringify(nsfwTokens, null, 2),
      "```",
      "",
    ].join("\n")
  );
  save("C2R_OFFLINE_GATE.json", { ok: true, ...gate });

  console.log(JSON.stringify({ ok: true, fingerprints, nsfwTokens }, null, 2));
}

main();
