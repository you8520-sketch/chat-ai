import "server-only";

import fs from "node:fs";
import path from "node:path";

import { getDataDir } from "@/lib/dataDir";
import { officialModerationVerdict } from "@/lib/officialSupply/moderation";
import { PILOT_STYLE_PROOF_BATCH_CONFIG } from "@/lib/officialSupply/pilotStyleProof";
import { ROFAN_V4_PRODUCTION_BATCH_CONFIG } from "@/lib/officialSupply/pilotProduction";
import {
  fileOfficialAssetSpool,
  openAiOfficialImageTransport,
  sharpOfficialImageOps,
  uploadOfficialAssetStorage,
  visionOfficialAssetModerator,
} from "@/lib/officialSupply/productionAdapters";
import {
  moderateOfficialAssetSlot,
  runOfficialAssetSlot,
} from "@/lib/officialSupply/runner";
import { OfficialSupplyStore } from "@/lib/officialSupply/store";
import {
  PILOT_STYLE_PROOF_V4_BATCH_KEY,
  PILOT_STYLE_PROOF_V4_STYLE_KEY,
} from "@/lib/officialSupply/userOwnedRofanStyleRefs";

const LIVE_ENV = "OFFICIAL_LUCIAN_VARIATIONS_LIVE";
const DRAFT_KEY = "pilot-rf-v4-03";
const REP_SLOT = "rep";
const WORKER_ID = `official-lucian-variations-${process.pid}`;
const PACKET_PATH = path.join(
  getDataDir(),
  "official-supply",
  "lucian-v4-variation-review.json"
);

function stop(message: string): never {
  throw new Error(`LUCIAN_VARIATIONS STOP: ${message}`);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function snapshotOtherV4Rows(store: OfficialSupplyStore): string {
  const characters = store.database
    .prepare(
      `SELECT * FROM official_supply_characters
       WHERE style_key=? AND draft_key<>?
       ORDER BY draft_key`
    )
    .all(PILOT_STYLE_PROOF_V4_STYLE_KEY, DRAFT_KEY);
  const assets = store.database
    .prepare(
      `SELECT a.*
         FROM official_supply_assets a
         JOIN official_supply_characters c ON c.draft_key=a.draft_key
        WHERE c.style_key=? AND c.draft_key<>?
        ORDER BY c.draft_key, a.id`
    )
    .all(PILOT_STYLE_PROOF_V4_STYLE_KEY, DRAFT_KEY);
  return stable({ characters, assets });
}

async function main(): Promise<void> {
  if (process.env[LIVE_ENV] !== "1") {
    console.log(
      `[lucian-v4-variations] NOT_RUN: set ${LIVE_ENV}=1 for the bounded Lucian-only run`
    );
    return;
  }

  const store = new OfficialSupplyStore();
  const character = store.getCharacter(DRAFT_KEY);
  if (character.batchKey !== PILOT_STYLE_PROOF_V4_BATCH_KEY) {
    stop(`batch=${character.batchKey}; expected ${PILOT_STYLE_PROOF_V4_BATCH_KEY}`);
  }
  if (character.styleKey !== PILOT_STYLE_PROOF_V4_STYLE_KEY) {
    stop(`style=${character.styleKey}; expected ${PILOT_STYLE_PROOF_V4_STYLE_KEY}`);
  }
  if (character.stage !== "anchor_approved") {
    stop(`character stage=${character.stage}; anchor_approved required`);
  }
  if (!character.assetPlan || character.assetPlan.slots.length !== 14) {
    stop("Lucian asset plan must contain exactly 14 slots");
  }

  const style = store.getStyle(PILOT_STYLE_PROOF_V4_STYLE_KEY);
  if (style.stage !== "style_locked") {
    stop(`style stage=${style.stage}; style_locked required`);
  }

  const rep = store.representativeAsset(DRAFT_KEY);
  if (
    rep.slotKey !== REP_SLOT ||
    rep.kind !== "representative" ||
    rep.status !== "approved" ||
    rep.attempts !== 1 ||
    !rep.resultUrl ||
    !rep.qa
  ) {
    stop("approved representative anchor is missing or drifted");
  }
  const repModeration = officialModerationVerdict(rep.moderation);
  if (repModeration !== "clean") {
    stop(`SFW representative moderation=${repModeration}; clean required`);
  }
  if (rep.appearanceLockHash !== character.appearanceLockHash) {
    stop("representative predates current Appearance Lock");
  }

  const variationPlans = character.assetPlan.slots.filter(
    (slot) => slot.kind !== "representative"
  );
  if (variationPlans.length !== 13) {
    stop(`variation slot count=${variationPlans.length}; expected 13`);
  }

  const beforeOther = snapshotOtherV4Rows(store);

  const promoted = store.promoteBatchConfigAfterStyleLock(
    PILOT_STYLE_PROOF_V4_BATCH_KEY,
    PILOT_STYLE_PROOF_BATCH_CONFIG,
    ROFAN_V4_PRODUCTION_BATCH_CONFIG
  );
  if (stable(promoted.config) !== stable(ROFAN_V4_PRODUCTION_BATCH_CONFIG)) {
    stop("production batch config did not persist exactly");
  }

  const deps = {
    store,
    transport: openAiOfficialImageTransport,
    imageOps: sharpOfficialImageOps,
    storage: uploadOfficialAssetStorage,
    spool: fileOfficialAssetSpool(),
    workerId: WORKER_ID,
    env: process.env,
  };

  const generated: Array<Record<string, unknown>> = [];
  for (const plan of variationPlans) {
    const before = store.getAsset(DRAFT_KEY, plan.slotKey);
    if (before.kind === "representative") {
      stop(`${plan.slotKey} unexpectedly resolved to representative`);
    }
    if (before.status === "approved") {
      stop(`${plan.slotKey} is already QA-approved; this operator is generation-only`);
    }
    if (
      !["planned", "failed", "generated", "upload_pending"].includes(before.status)
    ) {
      stop(
        `${plan.slotKey} status=${before.status}; expected planned/failed/generated/upload_pending`
      );
    }
    if (before.attempts > ROFAN_V4_PRODUCTION_BATCH_CONFIG.maxAttemptsPerSlot) {
      stop(`${plan.slotKey} attempts=${before.attempts} exceeds production cap`);
    }

    const outcome = await runOfficialAssetSlot(deps, DRAFT_KEY, plan.slotKey);
    if (
      outcome.status !== "generated" &&
      outcome.status !== "already_generated"
    ) {
      stop(
        `${plan.slotKey} generation outcome=${outcome.status}${
          "error" in outcome ? `: ${outcome.error}` : ""
        }`
      );
    }

    let asset = store.getAsset(DRAFT_KEY, plan.slotKey);
    if (!asset.resultUrl || asset.status !== "generated") {
      stop(`${plan.slotKey} has no generated result after runner completion`);
    }

    if (!asset.moderation) {
      await moderateOfficialAssetSlot(
        { store, moderator: visionOfficialAssetModerator },
        DRAFT_KEY,
        plan.slotKey
      );
      asset = store.getAsset(DRAFT_KEY, plan.slotKey);
    }

    const verdict = officialModerationVerdict(asset.moderation);
    if (verdict !== "clean") {
      stop(`${plan.slotKey} SFW moderation=${verdict}; clean required`);
    }
    if (
      asset.appearanceLockHash !== character.appearanceLockHash ||
      asset.hasUnknownCost ||
      asset.attempts < 1 ||
      asset.attempts > ROFAN_V4_PRODUCTION_BATCH_CONFIG.maxAttemptsPerSlot
    ) {
      stop(`${plan.slotKey} provenance/attempt state drifted`);
    }

    generated.push({
      slotKey: plan.slotKey,
      kind: plan.kind,
      tag: plan.tag,
      expression: plan.expression,
      pose: plan.pose,
      location: plan.location,
      situation: plan.situation,
      resultUrl: asset.resultUrl,
      width: asset.width,
      height: asset.height,
      attempts: asset.attempts,
      model: asset.model,
      spentUsd: asset.spentUsd,
      moderation: asset.moderation,
      qa: asset.qa,
    });
  }

  const afterCharacter = store.getCharacter(DRAFT_KEY);
  if (afterCharacter.stage !== "anchor_approved") {
    stop(
      `generation changed character stage to ${afterCharacter.stage}; visual QA must remain pending`
    );
  }

  const allAssets = store.listAssets(DRAFT_KEY);
  if (allAssets.length !== 14) stop(`asset count=${allAssets.length}; expected 14`);
  const nonRep = allAssets.filter((asset) => asset.kind !== "representative");
  if (
    nonRep.some(
      (asset) =>
        asset.status !== "generated" ||
        !asset.resultUrl ||
        !asset.moderation ||
        asset.qa !== null
    )
  ) {
    stop("not every variation is generated+moderated with QA still pending");
  }

  const afterOther = snapshotOtherV4Rows(store);
  if (afterOther !== beforeOther) {
    stop("another v4 character or asset changed during Lucian variation generation");
  }

  fs.mkdirSync(path.dirname(PACKET_PATH), { recursive: true });
  const packet = {
    status: "LUCIAN_VARIATIONS_GENERATED_AWAITING_VISUAL_QA",
    draftKey: DRAFT_KEY,
    name: afterCharacter.draft.name,
    characterStage: afterCharacter.stage,
    productionBatchConfig: promoted.config,
    representative: {
      resultUrl: rep.resultUrl,
      attempts: rep.attempts,
      spentUsd: rep.spentUsd,
    },
    variationCount: generated.length,
    variations: generated,
    totalCharacterSpentUsd: allAssets.reduce(
      (sum, asset) => sum + asset.spentUsd,
      0
    ),
    otherCharactersChanged: 0,
    finalQaNotRun: true,
    stagingNotRun: true,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PACKET_PATH, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  console.log(`[lucian-v4-variations] packet=${PACKET_PATH}`);
  console.log(JSON.stringify(packet));
}

main().catch((error) => {
  console.error(
    "[lucian-v4-variations] STOP:",
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
  process.exit(1);
});
