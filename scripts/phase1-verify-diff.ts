/**
 * Compare Phase 1 verify JSON dumps.
 * Usage: npx.cmd tsx scripts/phase1-verify-diff.ts before.json after.json
 */
import fs from "fs";
import path from "path";

type Report = {
  hashes: Record<string, string>;
  charCounts: Record<string, number>;
  sections: {
    systemPrompt: string;
    cacheRules: string;
    characterBlocks: string;
    dynamicBlocks: string;
    terminalBlocks: string;
    ruleLengthControl: string;
    openRouterSplit: {
      systemRulesBlock: string;
      characterSettingsBlock: string;
      dynamicBlock: string;
    } | null;
  };
  sceneCompletionControlTrace?: {
    classification: string;
  };
};

function lineDiff(a: string, b: string): number {
  const la = a.split("\n");
  const lb = b.split("\n");
  const max = Math.max(la.length, lb.length);
  let diff = 0;
  for (let i = 0; i < max; i++) {
    if (la[i] !== lb[i]) diff++;
  }
  return diff;
}

function main() {
  const beforePath = path.resolve(process.argv[2] ?? "output/phase1-verify-before.json");
  const afterPath = path.resolve(process.argv[3] ?? "output/phase1-verify-after.json");
  const before: Report = JSON.parse(fs.readFileSync(beforePath, "utf8"));
  const after: Report = JSON.parse(fs.readFileSync(afterPath, "utf8"));

  const keys = [
    "systemPrompt",
    "cacheRules",
    "characterBlocks",
    "dynamicBlocks",
    "terminalBlocks",
    "ruleLengthControl",
    "openRouterSplitFull",
  ] as const;

  const lines: string[] = [];
  lines.push("PHASE 1 PROMPT VERIFICATION REPORT");
  lines.push(`before: ${beforePath}`);
  lines.push(`after: ${afterPath}`);
  lines.push("");

  let allHashMatch = true;
  let totalSystemDiffLines = 0;

  for (const k of keys) {
    const hBefore = before.hashes[k];
    const hAfter = after.hashes[k];
    const match = hBefore === hAfter;
    if (!match) allHashMatch = false;
    lines.push(
      `${k}: hash_match=${match} before=${hBefore} after=${hAfter} chars_before=${before.charCounts[k.replace("Full", "") as keyof Report["charCounts"]] ?? "—"} chars_after=${after.charCounts[k.replace("Full", "") as keyof Report["charCounts"]] ?? "—"}`
    );
  }

  totalSystemDiffLines = lineDiff(
    before.sections.systemPrompt,
    after.sections.systemPrompt
  );
  lines.push("");
  lines.push(`systemPrompt diff line count: ${totalSystemDiffLines}`);
  lines.push(
    `sceneCompletionControl (after): ${after.sceneCompletionControlTrace?.classification ?? "unknown"}`
  );

  const pass = allHashMatch && totalSystemDiffLines === 0;
  lines.push("");
  lines.push(`VERDICT: ${pass ? "PASS" : "FAIL"}`);

  if (!pass) {
    lines.push("");
    lines.push("BLOCK DIFFS (first mismatch per block):");
    const blockKeys: Array<{ label: string; key: keyof Report["sections"] }> = [
      { label: "rule-length-control", key: "ruleLengthControl" },
      { label: "terminal", key: "terminalBlocks" },
      { label: "cacheRules", key: "cacheRules" },
      { label: "characterBlocks", key: "characterBlocks" },
      { label: "dynamicBlocks", key: "dynamicBlocks" },
    ];
    for (const { label, key } of blockKeys) {
      const a = before.sections[key] as string;
      const b = after.sections[key] as string;
      if (a !== b) {
        lines.push(`--- ${label} (${lineDiff(a, b)} line diffs) ---`);
        const la = a.split("\n");
        const lb = b.split("\n");
        for (let i = 0; i < Math.max(la.length, lb.length); i++) {
          if (la[i] !== lb[i]) {
            lines.push(`  line ${i + 1} BEFORE: ${(la[i] ?? "").slice(0, 120)}`);
            lines.push(`  line ${i + 1} AFTER:  ${(lb[i] ?? "").slice(0, 120)}`);
            break;
          }
        }
      }
    }
    if (before.sections.systemPrompt !== after.sections.systemPrompt) {
      lines.push(`--- systemPrompt full diff lines: ${totalSystemDiffLines} ---`);
    }
  }

  const out = lines.join("\n");
  fs.writeFileSync(path.join("output", "phase1-verify-report.txt"), out, "utf8");
  console.log(out);
  process.exit(pass ? 0 : 1);
}

main();
