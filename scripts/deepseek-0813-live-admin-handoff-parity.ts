import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateAdminHandoffParity } from "../src/lib/adminHandoffParity";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs/audits/deepseek-0813-live-admin-handoff");

function main(): void {
  const parity = evaluateAdminHandoffParity();
  const payload = {
    LIVE_ADMIN_HANDOFF_FIXTURE_CAPTURE: "STOPPED_BEFORE_LIVE_CHAT",
    ADMIN_PARITY_PROVEN: parity.ADMIN_PARITY_PROVEN,
    CHARACTER: null,
    PERSONA: null,
    SOURCE_MODEL: "gemini-3.7-flash",
    FIXTURE_ID: null,
    PRODUCTION_EQUIVALENT: false,
    CHARACTER_PROVEN: false,
    PERSONA_PROVEN: false,
    SPEECH_LOCK_PROVEN: false,
    WORLD_CANON_PROVEN: false,
    SYSTEM_PROVEN: false,
    HISTORY_PROVEN: false,
    SOURCE_ASSISTANT_PROVEN: false,
    CURRENT_USER_PROVEN: false,
    ROUTING_PROVEN: false,
    TRANSPORT_PROVEN: false,
    DEEPSEEK_CALLS: parity.DEEPSEEK_CALLS,
    TURN_OWNERSHIP_TESTED: false,
    MULTITURN_CHAIN_LENGTH: 0,
    MODEL_CALLS_GENERATING_USER_TURNS: parity.MODEL_CALLS_GENERATING_USER_TURNS,
    SOURCE_MIRROR: false,
    COMPLETION: false,
    ORIGIN_POINTER: false,
    PRODUCTION_CHANGED: false,
    MAIN_MERGED: false,
    RAILWAY_DEPLOYED: false,
    reason: parity.reason,
    blockers: parity.blockers,
    specialPaths: parity.specialPaths,
    promptLoaders: parity.promptLoaders,
    historical_restoration: "stopped",
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, "PARITY.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(
    [
      "LIVE_ADMIN_HANDOFF_FIXTURE_CAPTURE",
      `ADMIN_PARITY_PROVEN=${String(parity.ADMIN_PARITY_PROVEN)}`,
      `DEEPSEEK_CALLS=${String(parity.DEEPSEEK_CALLS)}`,
      `MODEL_CALLS_GENERATING_USER_TURNS=${String(parity.MODEL_CALLS_GENERATING_USER_TURNS)}`,
      `REASON=${parity.reason}`,
      "PRODUCTION_CHANGED=false",
      "STOP",
      "",
    ].join("\n")
  );
}

main();
