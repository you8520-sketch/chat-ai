/**
 * Re-score cached staging Leon runs after compliance scorer fix (no regeneration).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  classifyLineRegister,
  evaluateRegisterCompliance,
  isNeutralScoringLine,
} from "@/lib/characterRegisterCompliance";
import { extractDialogueLines, evaluateStep73Sample } from "@/lib/registerMetaAudit";

const CACHE = join(process.cwd(), "output/step76b-staging-staging_tagged_db.json");
const OUT_MD = join(process.cwd(), "output/step76b-staging-rescore-audit.md");
const OUT_JSON = join(process.cwd(), "output/step76b-staging-rescore-audit.json");

const PASS_THRESHOLD = 70;
const SCENE_GENRES = ["로맨스/판타지"] as const;

type Backlog =
  | "(a) register error"
  | "(b) typo — generation quality"
  | "(c) 1st-person 나 — voice"
  | "(d) harness/scoring noise";

function assignBacklog(
  run: number,
  text: string,
  driftKinds: string[],
  pass: boolean
): Backlog | "pass" {
  if (pass) return "pass";
  if (driftKinds.length > 0) return "(a) register error";
  if (run === 8 || /괜아나요/.test(text)) return "(b) typo — generation quality";
  if (/\b나(?:는|도|를|의|)\b/.test(text) && extractDialogueLines(text).some((l) => /\b나/.test(l))) {
    return "(c) 1st-person 나 — voice";
  }
  return "(d) harness/scoring noise";
}

function rescoreSample(run: number, text: string) {
  const comp = evaluateRegisterCompliance(text, "haeyo");
  const step73 = evaluateStep73Sample("leon-private-1", text, [...SCENE_GENRES]);
  const pass = comp.complianceRate >= PASS_THRESHOLD && step73.registerSwitching !== "FAIL";
  const lines = extractDialogueLines(text).map((line) => ({
    line,
    register: classifyLineRegister(line),
    neutral: isNeutralScoringLine(line),
  }));
  const bucket = assignBacklog(run, text, comp.driftKinds, pass);
  return { run, pass, compliance: comp.complianceRate, ...comp, registerSwitching: step73.registerSwitching, lines, bucket };
}

function main() {
  const j = JSON.parse(readFileSync(CACHE, "utf8")) as {
    samples: { run: number; pass: boolean; compliance: number; text: string }[];
  };

  const runs = j.samples.map((s) => {
    const r = rescoreSample(s.run, s.text);
    return {
      ...r,
      cachedPass: s.pass,
      cachedCompliance: s.compliance,
    };
  });

  const passCount = runs.filter((r) => r.pass).length;
  const cachedPassCount = runs.filter((r) => r.cachedPass).length;

  const backlogs: Record<Backlog, number[]> = {
    "(a) register error": [],
    "(b) typo — generation quality": [],
    "(c) 1st-person 나 — voice": [],
    "(d) harness/scoring noise": [],
  };
  for (const r of runs.filter((x) => !x.pass)) {
    if (r.bucket !== "pass") backlogs[r.bucket].push(r.run);
  }

  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        cachedPassRate: Math.round((cachedPassCount / runs.length) * 1000) / 10,
        rescoredPassRate: Math.round((passCount / runs.length) * 1000) / 10,
        passThreshold: PASS_THRESHOLD,
        backlogs,
        runs,
      },
      null,
      2
    )
  );

  const md = [
    "# Staging Leon — compliance scorer audit + rescore",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    "| Metric | pass rate |",
    "|--------|-----------|",
    `| Cached (old scorer) | ${cachedPassCount}/${runs.length} = ${Math.round((cachedPassCount / runs.length) * 1000) / 10}% |`,
    `| **Rescored (fixed scorer, same 12 texts)** | **${passCount}/${runs.length} = ${Math.round((passCount / runs.length) * 1000) / 10}%** |`,
    "",
    "## Scorer criteria (after fix)",
    "",
    "- **Denominator:** quoted dialogue lines **minus neutral fragments** (ellipsis-only, name-only, trailing-`...` without register cue).",
    "- **Haeyo match:** expanded endings (`줘요`, `자요`, `돼요`, …) + last-clause after `...` + haeyo anywhere if no drift ending.",
    "- **Typo `괜아나요`:** counts as haeyo intent (generation quality backlog, not register fail).",
    "- **1st-person `나`:** not a register violation; tracked separately as backlog (c).",
    "- **Short fragments (`…이쪽으로.`):** neutral — not register fail.",
    "",
    "## Failure backlogs (separate — do not merge)",
    "",
    "| Backlog | runs | count |",
    "|---------|------|-------|",
    ...Object.entries(backlogs).map(
      ([k, v]) => `| ${k} | ${v.length ? v.join(", ") : "—"} | ${v.length} |`
    ),
    "",
    "## Per-run (cached fail → rescored)",
    "",
  ];

  for (const r of runs.filter((x) => !x.cachedPass || !x.pass)) {
    md.push(`### Run ${r.run} → ${r.pass ? "PASS" : "FAIL"} (${r.cachedCompliance}% → ${r.compliance}%)`);
    md.push(`- Backlog: **${r.bucket}** | drift: ${r.driftKinds.length ? r.driftKinds.join(", ") : "none"}`);
    md.push("");
    md.push("| neutral | register | line |");
    md.push("|---------|----------|------|");
    for (const l of r.lines) {
      md.push(`| ${l.neutral ? "yes" : ""} | ${l.register} | ${l.line.slice(0, 55).replace(/\|/g, "\\|")} |`);
    }
    md.push("");
  }

  writeFileSync(OUT_MD, md.join("\n"));
  console.log(`Rescored ${passCount}/${runs.length} (was ${cachedPassCount}/${runs.length})`);
  console.log(`Wrote ${OUT_MD}`);
}

main();
