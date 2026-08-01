/**
 * Luna Minimal Core V1 — deterministic precheck (apiCallsExecuted=0).
 * Re-applies production detectRpMetaLeakage to SceneDirective V2 6-call artifacts + agency.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { detectRpMetaLeakage } from "../src/lib/narrativeRules";
import { evalAgency } from "./lib/lunaAgencyEval";

const OUT = process.env.SCREENING_OUT_DIR || "data";
const RAW = `${OUT}/luna-scene-directive-v2-independent-raw.txt`;

type ParsedCall = {
  callId: string;
  prose: string;
};

function parseRawFile(text: string): ParsedCall[] {
  const calls: ParsedCall[] = [];
  const normalized = text.replace(/^\uFEFF/, "");
  const blocks = normalized.split(/===== /).filter(Boolean);
  for (const block of blocks) {
    const headerEnd = block.indexOf(" =====");
    if (headerEnd < 0) continue;
    const callId = block.slice(0, headerEnd).trim();
    const body = block.slice(headerEnd + " =====".length).replace(/^\r?\n/, "");
    const nl = body.indexOf("\n");
    if (nl < 0) continue;
    const firstLine = body.slice(0, nl).trim();
    if (!firstLine.startsWith("{")) continue;
    const prose = body.slice(nl + 1).trim();
    if (!/^(H1|M1|U1)-(D|V)/.test(callId)) continue;
    calls.push({ callId, prose });
  }
  return calls;
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const raw = readFileSync(RAW, "utf8");
  const calls = parseRawFile(raw);
  if (calls.length !== 6) {
    throw new Error(`expected 6 calls in raw, found ${calls.length}`);
  }

  const rows = calls.map((c) => {
    const leakage = detectRpMetaLeakage(c.prose);
    const agency = evalAgency(c.prose);
    return { ...c, leakage, agency };
  });

  const expected: Record<string, "PASS" | "FAILURE"> = {
    "H1-D": "PASS",
    "H1-V": "PASS",
    "M1-D": "PASS",
    "M1-V": "PASS",
    "U1-D": "PASS",
    "U1-V": "FAILURE",
  };

  const mismatches = rows.filter((r) => {
    const key = r.callId.match(/^(H1|M1|U1)-(D|V)/)?.[0] ?? r.callId;
    const exp = expected[key];
    return exp != null && r.leakage.status !== exp;
  });

  const humanAgencyViolations = rows.filter((r) => r.agency.agencyViolation).length;

  const lines = [
    "# Luna Minimal Core V1 — Deterministic Precheck",
    `generatedAt=${new Date().toISOString()}`,
    "apiCallsExecuted=0",
    "sceneDirectiveCodeChangesMade=false",
    "sceneDirectiveApiCallsExecuted=0",
    "",
    "## SceneDirective scope note",
    "sceneDirectiveV2Included=false means gate candidate excludes experimental V2 canonical block.",
    "Production legacy V1 SceneDirective planner/inject path is preserved unchanged.",
    "leak occurred on V call=true (U1-V sample)",
    "SceneDirective caused leak=not proven",
    "runtime prompt rule added for leakage=false",
    "general output safety layer=true",
    "",
    "## Production static audit (read-only)",
    "productionScenePlannerExecuted=true (buildSceneDirective each chat request)",
    "productionSceneDirectiveBlockInjected=true (legacy V1 or Living via resolveScenePacingPromptOwner)",
    "productionDirectiveSource=legacy_v1 default when SCENE_DIRECTIVE_V2_MODE=off and Living off",
    "productionCurrentSceneFactsUsed=false (not passed in chat route buildSceneDirective)",
    "sceneDirectiveV2Inject default=false (SCENE_DIRECTIVE_V2_MODE=off)",
    "auditClassification=existing V1 directive inject preserved; experimental V2 block not in Minimal Core gate",
    "",
    "## detectRpMetaLeakage re-eval (6 SceneDirective outputs)",
    ...rows.map(
      (r) =>
        `${r.callId} leakageStatus=${r.leakage.status} expected=${expected[r.callId.match(/^(H1|M1|U1)-(D|V)/)?.[0] ?? "?"] ?? "?"} markers=${r.leakage.matchedMarkers.join(",") || "none"}`
    ),
    "",
    `leakageReevalPass=${mismatches.length === 0}`,
    `leakageMismatches=${mismatches.map((m) => m.callId).join(",") || "none"}`,
    "",
    "## Agency re-eval",
    ...rows.map(
      (r) =>
        `${r.callId} agencyStatus=${r.agency.agencyStatus} agencyViolation=${r.agency.agencyViolation}`
    ),
    `humanAgencyViolations=${humanAgencyViolations}/6`,
    `agencyHardFailures=${humanAgencyViolations}/6`,
    "",
    "## U1-V leak excerpt (if FAILURE)",
    ...(rows
      .find((r) => r.callId.startsWith("U1-V"))
      ?.leakage.matchedLines.map((l) => `- ${l}`) ?? []),
  ];

  writeFileSync(`${OUT}/luna-minimal-core-v1-precheck.txt`, lines.join("\n"), "utf8");
  console.log(lines.join("\n"));

  if (mismatches.length > 0 || humanAgencyViolations > 0) {
    process.exitCode = 1;
  }
}

main();
