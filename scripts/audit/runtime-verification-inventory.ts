/**
 * Read-only inventory of runtime verification coverage vs known gap classes.
 * Does NOT run Playwright or mutate application state.
 *
 * Usage: tsx scripts/audit/runtime-verification-inventory.ts
 */
import fs from "node:fs";
import path from "node:path";

const UI_SPEC_DIR = path.join(process.cwd(), "tests/ui");

const GAP_CLASSES = [
  "api_500_while_ui_ok",
  "silent_console_error",
  "stale_client_state",
  "route_transition_failure",
  "request_duplication",
  "streaming_final_divergence",
  "regeneration_failure",
  "receipt_state_mismatch",
  "status_widget_lifecycle_failure",
  "login_session_persistence_failure",
] as const;

function readUiSpecs(): string[] {
  if (!fs.existsSync(UI_SPEC_DIR)) return [];
  return fs
    .readdirSync(UI_SPEC_DIR)
    .filter((f) => f.endsWith(".spec.ts"))
    .map((f) => fs.readFileSync(path.join(UI_SPEC_DIR, f), "utf8"));
}

function detectPatterns(specBodies: string[]) {
  const joined = specBodies.join("\n");
  return {
    mocksChatApi: /route\.fulfill|mockChatStreamRoute|buildMockChatSseBody/.test(joined),
    consoleListener: /page\.on\(['"]console['"]/.test(joined),
    sessionReloadTest: /reload\(\)|storageState|cookie/.test(joined),
    api500Test: /status:\s*500|500.*route/.test(joined),
    realChatStream: /\/api\/chat/.test(joined) && !/mock/i.test(joined),
  };
}

function classifyGaps(patterns: ReturnType<typeof detectPatterns>) {
  const covered: string[] = [];
  const gaps: string[] = [];

  if (patterns.api500Test) covered.push("api_500_while_ui_ok");
  else gaps.push("api_500_while_ui_ok");

  if (patterns.consoleListener) covered.push("silent_console_error");
  else gaps.push("silent_console_error");

  if (patterns.sessionReloadTest) covered.push("login_session_persistence_failure");
  else gaps.push("login_session_persistence_failure");

  gaps.push(
    "route_transition_failure",
    "request_duplication",
    "streaming_final_divergence",
    "regeneration_failure",
    "receipt_state_mismatch",
    "status_widget_lifecycle_failure"
  );

  if (patterns.mocksChatApi) {
    gaps.push("streaming_final_divergence (Playwright uses mocked SSE)");
  }

  return { covered, gaps: [...new Set(gaps)] };
}

function main() {
  const specs = readUiSpecs();
  const patterns = detectPatterns(specs);
  const { covered, gaps } = classifyGaps(patterns);

  console.log(
    JSON.stringify(
      {
        ok: true,
        proof: "runtime-verification-inventory",
        uiSpecCount: specs.length,
        uiSpecFiles: fs.readdirSync(UI_SPEC_DIR).filter((f) => f.endsWith(".spec.ts")),
        patterns,
        gapClasses: GAP_CLASSES,
        covered,
        gaps,
        reticlePresentInRepo: false,
        jevRaPresentInRepo: false,
        reticleAssessment:
          "Not recommended currently; no proven incremental value over extending existing Playwright. Absence from repo is not an incompatibility proof.",
        recommendation:
          "Extend existing Playwright (do not add parallel browser framework). Add console+5xx listeners and one unmocked canary path.",
      },
      null,
      2
    )
  );
}

main();
