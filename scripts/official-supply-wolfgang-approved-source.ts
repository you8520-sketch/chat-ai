import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDatabasePath } from "@/lib/dataDir";
import { computeAppearanceLockHash } from "@/lib/officialSupply/appearance";
import {
  approvedAssetReviewTemplate,
  approvedAssetStatus,
  openApprovedAssetOperator,
  runApprovedAssetApply,
  runApprovedAssetIntake,
  runApprovedAssetModeration,
  runApprovedAssetReview,
  runApprovedAssetRollback,
  type ModerationMeter,
} from "@/lib/officialSupply/approvedAssetApplyOperator";
import { computeTextLockHash } from "@/lib/officialSupply/characterText";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  WOLFGANG_APPROVED_SOURCE_RELATIVE,
  WOLFGANG_IN_PLACE_TARGET,
  wolfgangApprovedPersistedSourcePath,
} from "@/lib/officialSupply/inPlaceWolfgang";
import {
  isRailwayProductionApplyEnvironment,
  isRailwayProductionSqlitePath,
} from "@/lib/officialSupply/lockedSnapshotReconcileOperator";
import {
  createVisionOfficialAssetModerator,
  sharpOfficialImageOps,
  uploadOfficialAssetStorage,
} from "@/lib/officialSupply/productionAdapters";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import { visionModels } from "@/lib/vision";

const RAILWAY_PROJECT = "072644e5-ce50-49bb-ab2e-1f13bae6b149";
const RAILWAY_SERVICE = "chat-ai";
const RAILWAY_ENVIRONMENT = "production";
const PERSIST_BASENAME = "pilot-rf-02.source.json";
const PERSIST_REMOTE = `/data/${WOLFGANG_APPROVED_SOURCE_RELATIVE.replace(/\\/g, "/")}`;

function railwaySsh(remote: string): string {
  return `railway ssh -p ${RAILWAY_PROJECT} -s ${RAILWAY_SERVICE} -e ${RAILWAY_ENVIRONMENT} -i "$SSH_IDENTITY" -- ${remote}`;
}

function placeCommand(): string {
  return [
    `tar cz -C "$(dirname "$SOURCE")" "$(basename "$SOURCE")" | ${railwaySsh(
      `sh -c 'set -e; DEST=/data/official-supply/approved; mkdir -p "$DEST"; if [ -f "$DEST/${PERSIST_BASENAME}" ]; then cp -f "$DEST/${PERSIST_BASENAME}" "$DEST/${PERSIST_BASENAME}.bak"; fi; TMP=$(mktemp "$DEST/${PERSIST_BASENAME}.tmp.XXXXXX"); trap "rm -f \\"$TMP\\"" EXIT; tar xz -O > "$TMP"; test -s "$TMP"; mv -f "$TMP" "$DEST/${PERSIST_BASENAME}"'`
    )}`,
  ].join(" ");
}

function restoreCommand(): string {
  return railwaySsh(
    `sh -c 'set -e; DEST=/data/official-supply/approved; test -s "$DEST/${PERSIST_BASENAME}.bak"; cp -f "$DEST/${PERSIST_BASENAME}.bak" "$DEST/${PERSIST_BASENAME}"'`
  );
}

function inspect(): void {
  console.log(
    JSON.stringify(
      {
        status: "INSPECT",
        persistedToProduction: false,
        providerCalls: 0,
        sourceDraftKey: WOLFGANG_IN_PLACE_TARGET.sourceDraftKey,
        persistRelative: WOLFGANG_APPROVED_SOURCE_RELATIVE,
        persistResolved: wolfgangApprovedPersistedSourcePath(),
        persistRemote: PERSIST_REMOTE,
        previousTextLockHash: WOLFGANG_IN_PLACE_TARGET.previousTextLockHash,
        approvedTextLockHash: WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash,
        appearanceLockHash: WOLFGANG_IN_PLACE_TARGET.appearanceLockHash,
        missingBehavior: "approved_source_missing — no repo-sheet or previous-manuscript fallback",
        mismatchBehavior: "approved_source_text_lock_mismatch / approved_source_appearance_lock_mismatch",
        railwayReuse: "existing railway ssh tar-over-ssh atomic write; persistent DATA_DIR=/data",
        place: placeCommand(),
        restore: restoreCommand(),
        verify: "npm run official-supply:wolfgang-approved-source -- --verify <decrypted-source.json>",
        assets: ASSET_USAGE,
      },
      null,
      2
    )
  );
}

function verify(sourcePath: string): void {
  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new OfficialSupplyGateError("approved_source_missing", `local approved source is missing at ${resolved}`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wolfgang-approved-verify-"));
  const previousDataDir = process.env.DATA_DIR;
  const previousPilotDir = process.env.OFFICIAL_SUPPLY_PILOT_DIR;
  try {
    const dest = path.join(tmp, WOLFGANG_APPROVED_SOURCE_RELATIVE);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(resolved, dest);
    process.env.DATA_DIR = tmp;
    delete process.env.OFFICIAL_SUPPLY_PILOT_DIR;
    const source = loadCompiledOfficialCharacterSource(WOLFGANG_IN_PLACE_TARGET.sourceDraftKey);
    console.log(
      JSON.stringify(
        {
          status: "verified",
          persistedToProduction: false,
          persistRemote: PERSIST_REMOTE,
          textLockHash: computeTextLockHash(source.draft),
          appearanceLockHash: computeAppearanceLockHash(source.appearanceLock),
          approvedTextLockHash: WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash,
          approvedAppearanceLockHash: WOLFGANG_IN_PLACE_TARGET.appearanceLockHash,
        },
        null,
        2
      )
    );
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousPilotDir === undefined) delete process.env.OFFICIAL_SUPPLY_PILOT_DIR;
    else process.env.OFFICIAL_SUPPLY_PILOT_DIR = previousPilotDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const ASSET_STEPS = ["status", "intake", "moderate", "review", "apply", "rollback"] as const;
type AssetStep = (typeof ASSET_STEPS)[number];
const ASSET_MANIFEST_DEFAULT = "docs/official-supply/reviews/assets/wolfgang-asset-redesign/fourteen-f-candidates.json";
const ASSET_PLAN_DEFAULT = "src/lib/officialSupply/pilot/fixtures/pilot-rf-02-approved-asset-plan-f.json";
const ASSET_USAGE =
  "usage: official-supply-wolfgang-approved-source assets <status|intake|moderate|review|apply|rollback> " +
  "--admin-email <email> --character-id <id> [--execute] [--evidence <file>] [--apply-id <id>] " +
  "[--max-calls <n> --max-cost-usd <usd> --per-call-reserve-usd <usd>] [--manifest <file>] [--approved-plan <file>]";

function parseAssetFlags(args: readonly string[]): { step: AssetStep; flags: Map<string, string>; execute: boolean } {
  const step = args[0] as AssetStep;
  if (!ASSET_STEPS.includes(step)) throw new OfficialSupplyGateError("approved_source_usage", ASSET_USAGE);
  const flags = new Map<string, string>();
  let execute = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--execute") {
      execute = true;
      continue;
    }
    const value = args[i + 1];
    if (!arg.startsWith("--") || value == null || value.startsWith("--")) {
      throw new OfficialSupplyGateError("approved_source_usage", ASSET_USAGE);
    }
    flags.set(arg.slice(2), value);
    i++;
  }
  if (execute && step === "status") throw new OfficialSupplyGateError("approved_source_usage", "status never writes");
  return { step, flags, execute };
}

function productionDatabase(): boolean {
  return isRailwayProductionApplyEnvironment(process.env) || isRailwayProductionSqlitePath(getDatabasePath());
}

const visionModerationMeter: ModerationMeter = {
  attemptsPerCall: visionModels().length,
  createModerator: (control) => createVisionOfficialAssetModerator(control),
};

async function runAssetStep(args: readonly string[]): Promise<boolean> {
  const { step, flags, execute } = parseAssetFlags(args);
  const number = (key: string) => (flags.has(key) ? Number(flags.get(key)) : NaN);
  const target = openApprovedAssetOperator({
    store: new OfficialSupplyStore(),
    draftKey: flags.get("draft-key") ?? WOLFGANG_IN_PLACE_TARGET.supplyDraftKey,
    characterId: number("character-id"),
    adminEmail: flags.get("admin-email") ?? "",
    manifestPath: path.resolve(flags.get("manifest") ?? ASSET_MANIFEST_DEFAULT),
    approvedPlanPath: path.resolve(flags.get("approved-plan") ?? ASSET_PLAN_DEFAULT),
  });
  const print = (value: unknown) =>
    console.log(JSON.stringify({ db: getDatabasePath(), productionDatabase: productionDatabase(), ...(value as object) }, null, 2));
  switch (step) {
    case "status":
      print(approvedAssetStatus(target));
      return true;
    case "intake": {
      const report = await runApprovedAssetIntake(target, { storage: uploadOfficialAssetStorage, imageOps: sharpOfficialImageOps }, execute);
      print(report);
      return report.status !== "stopped";
    }
    case "moderate": {
      const budget =
        flags.has("max-calls") || flags.has("max-cost-usd") || flags.has("per-call-reserve-usd")
          ? { maxCalls: number("max-calls"), maxCostUsd: number("max-cost-usd"), perCallReserveUsd: number("per-call-reserve-usd") }
          : null;
      const report = await runApprovedAssetModeration(target, visionModerationMeter, budget, execute);
      print(report);
      return report.status !== "stopped";
    }
    case "review": {
      const evidence = flags.get("evidence");
      if (!evidence) {
        print({ step: "review", template: approvedAssetReviewTemplate(target) });
        return true;
      }
      print(
        runApprovedAssetReview(target, fs.readFileSync(path.resolve(evidence)), {
          execute,
          productionDatabase: productionDatabase(),
        })
      );
      return true;
    }
    case "apply": {
      const result = runApprovedAssetApply(target, execute);
      print({
        ...result,
        rollback: result.applyId
          ? `npm run official-supply:wolfgang-approved-source -- assets rollback --admin-email ${target.actor.email} --character-id ${target.characterId} --apply-id ${result.applyId}`
          : null,
      });
      return true;
    }
    case "rollback":
      print(runApprovedAssetRollback(target, flags.get("apply-id") ?? "", execute));
      return true;
    default: {
      const exhaustive: never = step;
      throw new OfficialSupplyGateError("approved_source_usage", String(exhaustive));
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    inspect();
    return;
  }
  if (argv[0] === "--verify" && argv[1] && argv.length === 2) {
    verify(argv[1]);
    return;
  }
  if (argv[0] === "assets") {
    if (!(await runAssetStep(argv.slice(1)))) process.exitCode = 1;
    return;
  }
  throw new OfficialSupplyGateError(
    "approved_source_usage",
    `usage: official-supply-wolfgang-approved-source [--verify <decrypted-source.json>]\n${ASSET_USAGE}`
  );
}

main().catch((error: unknown) => {
  const code = error instanceof OfficialSupplyGateError ? error.code : "approved_source_operator";
  console.error("[wolfgang-approved-source] STOP:", code, error instanceof Error ? error.message : String(error));
  process.exit(1);
});
