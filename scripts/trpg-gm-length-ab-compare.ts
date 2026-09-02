/**
 * Runs 6 provider calls: 3 on main baseline (ed24fedd) + 3 on current PR checkout.
 * Does not modify prompts. Writes comparison summary to artifacts.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const MAIN_SHA = "ed24fedd4990288526a524979e265377c805b0af";
const WORKTREE = resolve("/workspace/.worktrees/trpg-main-baseline");
const ARTIFACT_ROOT = "/opt/cursor/artifacts/trpg-gm-length-forensic";

function runForensic(label: string, promptRoot: string) {
  const outDir = join(ARTIFACT_ROOT, label);
  mkdirSync(outDir, { recursive: true });
  execSync(
    `node --conditions=react-server --import tsx scripts/trpg-gm-length-forensic.ts --label ${label}`,
    {
      cwd: resolve("/workspace"),
      env: {
        ...process.env,
        TRPG_PROMPT_ROOT: promptRoot,
        TRPG_FORENSIC_OUT_DIR: outDir,
      },
      stdio: "inherit",
    }
  );
}

type Row = {
  FIXTURE: string;
  COMPUTED_MIN_CHARS: number;
  PARSED_NARRATION_CHARS: number;
  MINIMUM_MET: boolean;
  INTEGRITY_STATUS: string;
  ENVELOPE_MALFORMED_KIND: string;
  FINISH_REASON: string | null;
};

function loadSummary(label: string): Row[] {
  const raw = readFileSync(join(ARTIFACT_ROOT, label, "summary.json"), "utf8");
  return (JSON.parse(raw) as { results: Row[] }).results;
}

function summarize(label: string, rows: Row[]) {
  const minPass = rows.filter((r) => r.MINIMUM_MET).length;
  const envelopeHealthy = rows.filter((r) => r.ENVELOPE_MALFORMED_KIND === "HEALTHY").length;
  const deficits = rows.map((r) => Math.max(0, r.COMPUTED_MIN_CHARS - r.PARSED_NARRATION_CHARS));
  const avgDeficit = deficits.reduce((a, b) => a + b, 0) / deficits.length;
  return { label, minPass, envelopeHealthy, avgDeficit, rows };
}

function ensureWorktree() {
  try {
    execSync(`git worktree add ${WORKTREE} ${MAIN_SHA} --detach`, {
      cwd: "/workspace",
      stdio: "pipe",
    });
  } catch {
    // already exists
  }
}

function main() {
  ensureWorktree();
  runForensic("main-baseline", WORKTREE);
  runForensic("pr833-patched", "/workspace");

  const baseline = summarize("main-baseline", loadSummary("main-baseline"));
  const patched = summarize("pr833-patched", loadSummary("pr833-patched"));

  const comparison = {
    LATEST_MAIN_SHA: MAIN_SHA,
    MAIN_BASELINE_LENGTH_PASS: `${baseline.minPass}/3`,
    PR833_LENGTH_PASS: `${patched.minPass}/3`,
    MAIN_BASELINE_ENVELOPE_HEALTHY: `${baseline.envelopeHealthy}/3`,
    PR833_ENVELOPE_HEALTHY: `${patched.envelopeHealthy}/3`,
    MAIN_BASELINE_AVERAGE_MIN_DEFICIT: baseline.avgDeficit,
    PR833_AVERAGE_MIN_DEFICIT: patched.avgDeficit,
    baseline,
    patched,
  };

  writeFileSync(join(ARTIFACT_ROOT, "ab-comparison.json"), JSON.stringify(comparison, null, 2));
  console.info(JSON.stringify(comparison, null, 2));
}

main();
