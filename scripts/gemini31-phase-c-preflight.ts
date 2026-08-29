/**
 * Phase C preflight — verify PR #724 artifacts present on current main.
 * READ-ONLY. No production mutations.
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-c-preflight.ts
 */
import fs from "node:fs";
import path from "node:path";
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import { adaptCheaperInferenceChatBody } from "../src/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "../src/lib/chatModels";
import { shouldInjectSystemLayoutRecency } from "../src/lib/gemini31LayoutOwnerPolicy";
import { prepareNonBlockingSummaryForMainRp } from "../src/lib/memory/memory-rolling-summary";
import { reconcileMemoryCoverageFixedPoint } from "../src/lib/memoryCoverageReconcile";
import { auditTokenAccounting } from "../src/lib/promptTokenAccounting";
import { logPromptSectionFingerprints } from "../src/lib/promptSectionFingerprint";

const ROOT = process.cwd();

function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

function readMainHead(): string {
  try {
    return fs.readFileSync(path.join(ROOT, ".git/refs/remotes/origin/main"), "utf8").trim();
  } catch {
    return "unknown";
  }
}

const checks: Record<string, boolean | string> = {
  MAIN_HEAD: readMainHead(),
  PR724_PRESENT_IN_MAIN: exists("src/lib/promptSectionFingerprint.ts"),
  PROMPT_SECTION_FINGERPRINT_OWNER: exists("src/lib/promptSectionFingerprint.ts"),
  FINAL_CONTEXT_TELEMETRY_POST_RECONCILE: (() => {
    const route = fs.readFileSync(path.join(ROOT, "src/app/api/chat/route.ts"), "utf8");
    const reconcileIdx = route.indexOf("reconcileMemoryCoverageFixedPoint");
    const syncIdx = route.indexOf("phaseAudit.setSectionFingerprint");
    return reconcileIdx > 0 && syncIdx > reconcileIdx;
  })(),
  SUMMARY_CONTENTION_SNAPSHOT: exists("src/lib/turnPhaseLatencyAudit.ts") &&
    fs.readFileSync(path.join(ROOT, "src/lib/turnPhaseLatencyAudit.ts"), "utf8").includes(
      "summary_contention"
    ),
  TOKEN_ACCOUNTING_AUDIT: exists("src/lib/promptTokenAccounting.ts"),
  MEMORY_NONBLOCKING_PREP: typeof prepareNonBlockingSummaryForMainRp === "function",
  MEMORY_RECONCILE_OWNER: typeof reconcileMemoryCoverageFixedPoint === "function",
};

const layoutDual = shouldInjectSystemLayoutRecency({
  terminalLayoutOwnerOnly: false,
  modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
});
checks.LAYOUT_DEFAULT_DUAL_INJECTION = layoutDual;

const built = buildContext({
  charName: "조태형",
  systemPrompt: "너는 조태형이다.",
  world: "에이지스.",
  exampleDialog: "…",
  chunks: [],
  userNickname: "렌",
  currentUserMessage: "안녕",
  shortTermHistory: [],
  modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  provider: "openrouter",
  chatId: 1,
});
const asm = assemblePrimaryRpRequest({
  system: built.systemPrompt,
  history: built.history,
  openRouterSystemSplit: built.openRouterSystemSplit,
  modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  provider: "cheaperinference",
});
const adapted = adaptCheaperInferenceChatBody(asm.requestBody);
checks.REASONING_WIRE_LOW =
  adapted.reasoning_effort === "low" &&
  !("thinking" in adapted) &&
  !("reasoning" in adapted);

const tokenAudit = auditTokenAccounting({
  localEstimatedTotal: 1000,
  localSystemTokens: 600,
  localHistoryTokens: 300,
  localUserTurnTokens: 100,
  providerPromptTokens: 950,
  providerCachedTokens: 400,
});
checks.TOKEN_ACCOUNTING_AUDIT_CALLABLE = tokenAudit.CANONICAL_TOKEN_OWNER === "provider_reported_prompt_tokens";

const fp = logPromptSectionFingerprints({
  scopeKey: "preflight",
  sections: built.meta.trackedSections ?? [],
});
checks.FINGERPRINT_TELEMETRY_CALLABLE = fp.fingerprints.length > 0;

const postMergeCommits = (() => {
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execSync("git log 80d15975..origin/main --oneline 2>/dev/null || true", {
      encoding: "utf8",
    }).trim();
    return out || "NONE";
  } catch {
    return "UNKNOWN";
  }
})();
checks.COMMITS_AFTER_PR724_MERGE = postMergeCommits;

const allPass =
  checks.PR724_PRESENT_IN_MAIN === true &&
  checks.PROMPT_SECTION_FINGERPRINT_OWNER === true &&
  checks.FINAL_CONTEXT_TELEMETRY_POST_RECONCILE === true &&
  checks.SUMMARY_CONTENTION_SNAPSHOT === true &&
  checks.TOKEN_ACCOUNTING_AUDIT === true &&
  checks.REASONING_WIRE_LOW === true &&
  checks.LAYOUT_DEFAULT_DUAL_INJECTION === true &&
  checks.MEMORY_NONBLOCKING_PREP === true &&
  postMergeCommits === "NONE";

console.log(
  JSON.stringify(
    {
      PHASE_C_PREFLIGHT: allPass ? "PASS" : "FAIL",
      checks,
      PHASE_C_START_ALLOWED: allPass,
    },
    null,
    2
  )
);

if (!allPass) process.exit(1);
