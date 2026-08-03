/**
 * Compose final matrix report from gate artifacts.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/opt/cursor/artifacts/deepseek-common-root-audit";

function load(name: string): unknown {
  const p = join(ROOT, "00-integrity", name);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

const p0 = load("P0_PARITY_GATE.json") as { verdict?: string; pass?: boolean } | null;
const p1 = load("P1_DISPLAY_VERDICT.json") as { verdict?: string } | null;
const d1 = load("D1_NPC_VERDICT.json") as { verdict?: string } | null;
const d2a = load("D2A_VERDICT.json") as { verdict?: string } | null;
const d2b = load("D2B_VERDICT.json") as { verdict?: string } | null;

const report = `# DeepSeek V4 Pro Matrix — Final Report

## Gates

| Step | Verdict |
| --- | --- |
| §1 Deploy | PASS (52e0141) |
| P0 | ${p0?.verdict ?? "UNKNOWN"} |
| P1 | ${p1?.verdict ?? "NOT_RUN"} |
| D1 | ${d1?.verdict ?? "NOT_RUN"} |
| D2a | ${d2a?.verdict ?? "NOT_RUN"} |
| D2b | ${d2b?.verdict ?? "NOT_RUN"} |

## Summary block

\`\`\`text
P0 parity: ${p0?.verdict ?? "UNKNOWN"}
P1 display result: ${p1?.verdict ?? "NOT_RUN"}
D1 NPC result: ${d1?.verdict ?? "NOT_RUN"}
D2a Pro-specific result: ${d2a?.verdict ?? "NOT_RUN"}
D2b length result: ${d2b?.verdict ?? "NOT_RUN"}
C1: NOT_RUN
C2: NOT_RUN
C3: NOT_RUN
C4: NOT_RUN
C5: NOT_RUN
confirmed root cause: pending
recommended minimal fix: pending
Terra cross-check: NOT_RUN
Flash cross-check: NOT_RUN

production DB apply: NO
general rollout: NO
auto merge: NO
\`\`\`
`;

writeFileSync(join(ROOT, "FINAL_REPORT.md"), report);
console.log(report);
