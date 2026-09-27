import "server-only";

import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "@/lib/dataDir";
import { officialModerationVerdict } from "@/lib/officialSupply/moderation";
import {
  PILOT_CLUSTER_B_PROOF_DRAFT_KEYS,
  PILOT_CLUSTER_B_PROOF_SLOT_KEY,
  PILOT_CLUSTER_B_PROOF_SOURCE_DRAFT_KEYS,
  pilotClusterBStyleProofDraftKey,
  pilotClusterBStyleProofOptedIn,
} from "@/lib/officialSupply/pilotClusterBStyleProof";
import { PILOT_STYLE_PROOF_CANDIDATE_ID } from "@/lib/officialSupply/pilotStyleProof";
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

const WORKER_ID = "rofan-v4-anchor-batch";
const EXPECTED_DRAFT_KEYS = PILOT_CLUSTER_B_PROOF_SOURCE_DRAFT_KEYS.map(
  pilotClusterBStyleProofDraftKey
);
const EXISTING_PROOF_KEYS = new Set<string>(PILOT_CLUSTER_B_PROOF_DRAFT_KEYS);
const EXPECTED_NEW_CALLS = EXPECTED_DRAFT_KEYS.length - EXISTING_PROOF_KEYS.size;
const PACKET_DIR = path.join(getDataDir(), "official-supply");
const PACKET_PATH = path.join(PACKET_DIR, "romance-fantasy-v4-anchor-review.json");

function stop(message: string): never {
  throw new Error(`ANCHOR_BATCH STOP: ${message}`);
}

function sameStringSet(actual: string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
}

function preflight(store: OfficialSupplyStore): void {
  const style = store.getStyle(PILOT_STYLE_PROOF_V4_STYLE_KEY);
  if (style.stage !== "style_locked") {
    stop(`style stage=${style.stage}; expected style_locked`);
  }
  if (style.approvedCandidateId !== PILOT_STYLE_PROOF_CANDIDATE_ID) {
    stop(
      `approved candidate=${style.approvedCandidateId}; expected ${PILOT_STYLE_PROOF_CANDIDATE_ID}`
    );
  }
  if (style.styleSeed?.styleCluster !== "cluster_b_graphic") {
    stop(`style cluster=${style.styleSeed?.styleCluster ?? "missing"}`);
  }

  const batch = store.getBatch(PILOT_STYLE_PROOF_V4_BATCH_KEY);
  if (batch.status !== "active") {
    stop(`batch status=${batch.status}: ${batch.pauseReason ?? ""}`);
  }

  const rows = store.database
    .prepare(
      `SELECT draft_key FROM official_supply_characters
       WHERE style_key=? ORDER BY draft_key`
    )
    .all(PILOT_STYLE_PROOF_V4_STYLE_KEY) as Array<{ draft_key: string }>;
  const actualDraftKeys = rows.map((row) => row.draft_key);
  if (!sameStringSet(actualDraftKeys, EXPECTED_DRAFT_KEYS)) {
    stop(
      `style characters mismatch: actual=${actualDraftKeys.join(",")} expected=${EXPECTED_DRAFT_KEYS.join(",")}`
    );
  }

  for (const draftKey of EXPECTED_DRAFT_KEYS) {
    const character = store.getCharacter(draftKey);
    if (character.batchKey !== PILOT_STYLE_PROOF_V4_BATCH_KEY) {
      stop(`${draftKey} batch=${character.batchKey}`);
    }
    if (character.stage !== "asset_plan_locked") {
      stop(`${draftKey} stage=${character.stage}; expected asset_plan_locked`);
    }

    const assets = store.listAssets(draftKey);
    if (assets.length !== 14) {
      stop(`${draftKey} asset count=${assets.length}; expected 14`);
    }

    const rep = store.getAsset(draftKey, PILOT_CLUSTER_B_PROOF_SLOT_KEY);
    if (rep.kind !== "representative") {
      stop(`${draftKey}/rep kind=${rep.kind}`);
    }

    const started = assets.filter((asset) => asset.attempts > 0);
    if (EXISTING_PROOF_KEYS.has(draftKey)) {
      if (
        started.length !== 1 ||
        started[0]?.slotKey !== PILOT_CLUSTER_B_PROOF_SLOT_KEY ||
        rep.attempts !== 1 ||
        rep.status !== "generated" ||
        !rep.resultUrl
      ) {
        stop(`${draftKey} existing proof state is not the expected single generated rep`);
      }
      const verdict = officialModerationVerdict(rep.moderation);
      if (verdict !== "clean" && verdict !== "adult_flagged") {
        stop(`${draftKey} existing proof moderation=${verdict}`);
      }
    } else {
      if (started.length !== 0) {
        stop(`${draftKey} already has started assets: ${started.map((a) => a.slotKey).join(",")}`);
      }
      if (rep.status !== "planned" || rep.attempts !== 0 || rep.resultUrl) {
        stop(`${draftKey}/rep is not pristine planned state`);
      }
    }

    const nonRepStarted = assets.filter(
      (asset) => asset.kind !== "representative" && asset.attempts > 0
    );
    if (nonRepStarted.length > 0) {
      stop(
        `${draftKey} has RP attempts before anchor approval: ${nonRepStarted
          .map((asset) => asset.slotKey)
          .join(",")}`
      );
    }
  }
}

async function main(): Promise<void> {
  if (!pilotClusterBStyleProofOptedIn()) {
    console.log(
      `[rofan-v4-anchor-batch] NOT_RUN: set OFFICIAL_STYLE_PROOF_LIVE=1 and OFFICIAL_STYLE_PROOF_CANDIDATE=${PILOT_STYLE_PROOF_CANDIDATE_ID}`
    );
    return;
  }

  const store = new OfficialSupplyStore();
  preflight(store);

  const deps = {
    store,
    transport: openAiOfficialImageTransport,
    imageOps: sharpOfficialImageOps,
    storage: uploadOfficialAssetStorage,
    spool: fileOfficialAssetSpool(),
    workerId: WORKER_ID,
    env: process.env,
  };

  let providerCallsStarted = 0;
  const anchors: Array<Record<string, unknown>> = [];

  for (const draftKey of EXPECTED_DRAFT_KEYS) {
    const before = store.getAsset(draftKey, PILOT_CLUSTER_B_PROOF_SLOT_KEY);
    if (before.attempts === 0) providerCallsStarted += 1;

    const outcome = await runOfficialAssetSlot(
      deps,
      draftKey,
      PILOT_CLUSTER_B_PROOF_SLOT_KEY
    );
    if (outcome.status !== "generated" && outcome.status !== "already_generated") {
      stop(
        `${draftKey} generation outcome=${outcome.status}${
          "error" in outcome ? `: ${outcome.error}` : ""
        }`
      );
    }

    let asset = store.getAsset(draftKey, PILOT_CLUSTER_B_PROOF_SLOT_KEY);
    if (!asset.resultUrl) stop(`${draftKey} has no representative result URL`);

    if (!asset.moderation) {
      await moderateOfficialAssetSlot(
        { store, moderator: visionOfficialAssetModerator },
        draftKey,
        PILOT_CLUSTER_B_PROOF_SLOT_KEY
      );
      asset = store.getAsset(draftKey, PILOT_CLUSTER_B_PROOF_SLOT_KEY);
    }

    const verdict = officialModerationVerdict(asset.moderation);
    if (verdict !== "clean" && verdict !== "adult_flagged") {
      stop(`${draftKey} moderation=${verdict}`);
    }

    anchors.push({
      draftKey,
      name: store.getCharacter(draftKey).draft.name,
      url: asset.resultUrl,
      width: asset.width,
      height: asset.height,
      model: asset.model,
      attempts: asset.attempts,
      spentUsd: asset.spentUsd,
      hasUnknownCost: asset.hasUnknownCost,
      moderation: asset.moderation,
    });
  }

  if (providerCallsStarted !== EXPECTED_NEW_CALLS) {
    stop(
      `new provider-call targets=${providerCallsStarted}; expected ${EXPECTED_NEW_CALLS}`
    );
  }

  const startedRows = store.database
    .prepare(
      `SELECT c.draft_key, a.slot_key, a.kind, a.status, a.attempts
         FROM official_supply_characters c
         JOIN official_supply_assets a ON a.draft_key=c.draft_key
        WHERE c.style_key=? AND a.attempts > 0
        ORDER BY c.draft_key, a.slot_key`
    )
    .all(PILOT_STYLE_PROOF_V4_STYLE_KEY) as Array<{
      draft_key: string;
      slot_key: string;
      kind: string;
      status: string;
      attempts: number;
    }>;

  if (startedRows.length !== EXPECTED_DRAFT_KEYS.length) {
    stop(`started asset count=${startedRows.length}; expected 10 representative anchors only`);
  }
  for (const row of startedRows) {
    if (
      !EXPECTED_DRAFT_KEYS.includes(row.draft_key) ||
      row.slot_key !== PILOT_CLUSTER_B_PROOF_SLOT_KEY ||
      row.kind !== "representative" ||
      row.status !== "generated" ||
      row.attempts !== 1
    ) {
      stop(
        `unexpected started asset ${row.draft_key}/${row.slot_key} kind=${row.kind} status=${row.status} attempts=${row.attempts}`
      );
    }
  }

  for (const draftKey of EXPECTED_DRAFT_KEYS) {
    const character = store.getCharacter(draftKey);
    if (character.stage !== "asset_plan_locked") {
      stop(`${draftKey} advanced to ${character.stage} before human anchor review`);
    }
  }

  fs.mkdirSync(PACKET_DIR, { recursive: true });
  const packet = {
    status: "ANCHORS_GENERATED_AWAITING_HUMAN_REVIEW",
    styleKey: PILOT_STYLE_PROOF_V4_STYLE_KEY,
    styleStage: store.getStyle(PILOT_STYLE_PROOF_V4_STYLE_KEY).stage,
    batchKey: PILOT_STYLE_PROOF_V4_BATCH_KEY,
    totalCharacters: EXPECTED_DRAFT_KEYS.length,
    existingProofAnchorsReused: EXISTING_PROOF_KEYS.size,
    newAnchorsGenerated: EXPECTED_NEW_CALLS,
    anchors,
    totalSpentUsd: anchors.reduce(
      (sum, anchor) => sum + Number(anchor.spentUsd ?? 0),
      0
    ),
    rpSlotsStarted: 0,
    humanAnchorReviewRequired: true,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PACKET_PATH, `${JSON.stringify(packet, null, 2)}\n`, "utf8");

  console.log(`[rofan-v4-anchor-batch] packet=${PACKET_PATH}`);
  console.log(JSON.stringify(packet));
}

main().catch((error) => {
  console.error(
    "[rofan-v4-anchor-batch] STOP:",
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
  process.exit(1);
});
