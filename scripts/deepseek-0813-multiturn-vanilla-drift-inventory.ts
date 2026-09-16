import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateKnownCommittedMultiTurnInventory,
  evaluateMultiTurnVanillaDriftReadiness,
  gemini37BaselinePartialChain,
} from "../src/lib/deepseekAdultHandoffMultiTurnInventory";
import { sha256Utf8 } from "../src/lib/deepseekAdultHandoffFixtureCapture";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs/audits/deepseek-0813-multiturn-vanilla-drift");

function fileSha(relativePath: string): string | null {
  try {
    const bytes = readFileSync(join(ROOT, relativePath));
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return null;
  }
}

function main(): void {
  const inventory = evaluateKnownCommittedMultiTurnInventory();
  const partial = evaluateMultiTurnVanillaDriftReadiness(
    gemini37BaselinePartialChain()
  );
  const t1RawPath = "docs/audits/gemini-37-flash-baseline/t1-raw.txt";
  const t2RawPath = "docs/audits/gemini-37-flash-baseline/t2-raw.txt";
  const payload = {
    TRACK: "MULTI-TURN VANILLA TRUE-OFF DRIFT",
    FIXTURE_AVAILABLE: inventory.fixtureAvailable,
    LIVE_CALLS: inventory.liveCalls,
    MODEL_CALLS: inventory.modelCalls,
    REASON: inventory.reason,
    PREFERRED_SOURCE: inventory.preferredSource,
    TARGET: "deepseek-v4-pro-0813",
    SOURCE_MIRROR: 0,
    COMPLETION: 0,
    CURRENT_STAGE_BOUNDARY: 0,
    FINGERPRINT: 0,
    MODEL_SPECIFIC_STYLE_ADAPTER: 0,
    ORIGIN_POINTER: 0,
    TURN_OWNERSHIP: 0,
    PRODUCTION_CHANGED: false,
    MAIN_MERGED: false,
    RAILWAY_DEPLOYED: false,
    QUALITY_SCORING_BY_CURSOR: false,
    candidates: inventory.candidates,
    gemini37_baseline: {
      t1_raw_path: t1RawPath,
      t1_raw_sha256: fileSha(t1RawPath),
      t2_raw_path: t2RawPath,
      t2_raw_sha256: fileSha(t2RawPath),
      matching_next_user: "같이 갈래? *두리번*",
      matching_next_user_sha256: sha256Utf8("같이 갈래? *두리번*"),
      deepseek_handoff_assistant_turns: 0,
    },
    partial_chain_readiness: partial,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, "INVENTORY.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(
    [
      "MULTI_TURN_VANILLA_TRUE_OFF_DRIFT_INVENTORY",
      `FIXTURE_AVAILABLE=${String(inventory.fixtureAvailable)}`,
      `LIVE_CALLS=${String(inventory.liveCalls)}`,
      `MODEL_CALLS=${String(inventory.modelCalls)}`,
      `REASON=${inventory.reason}`,
      "PRODUCTION_CHANGED=false",
      "STOP",
      "",
    ].join("\n")
  );
}

main();
