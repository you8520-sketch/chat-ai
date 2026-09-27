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
const SINGLE_TARGET_ENV = "OFFICIAL_ANCHOR_DRAFT_KEY";
const ALLOWED_SINGLE_TARGETS = EXPECTED_DRAFT_KEYS.filter(
  (draftKey) => !EXISTING_PROOF_KEYS.has(draftKey)
);
const PACKET_DIR = path.join(getDataDir(), "official-supply");
const PACKET_PATH = path.join(PACKET_DIR, "romance-fantasy-v4-single-anchor-review.json");

function stop(message: string): never {
  throw new Error(`ANCHOR_BATCH STOP: ${message}`);
}

function sameStringSet(actual: string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
}

function preflight(
  store: OfficialSupplyStore,
  targetDraftKey: string
): { previouslyApproved: number; stageSnapshot: Map<string, string> } {
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

  let previouslyApproved = 0;
  const stageSnapshot = new Map<string, string>();

  for (const draftKey of EXPECTED_DRAFT_KEYS) {
    const character = store.getCharacter(draftKey);
    stageSnapshot.set(draftKey, character.stage);

    if (character.batchKey !== PILOT_STYLE_PROOF_V4_BATCH_KEY) {
      stop(`${draftKey} batch=${character.batchKey}`);
    }

    const assets = store.listAssets(draftKey);
    if (assets.length !== 14) {
      stop(`${draftKey} asset count=${assets.length}; expected 14`);
    }

    const rep = store.getAsset(draftKey, PILOT_CLUSTER_B_PROOF_SLOT_KEY);
    if (rep.kind !== "representative") {
      stop(`${draftKey}/rep kind=${rep.kind}`);
    }

    const nonRepStarted = assets.filter(
      (asset) => asset.kind !== "representative" && asset.attempts > 0
    );
    if (nonRepStarted.length > 0) {
      stop(
        `${draftKey} has RP attempts before the 10-anchor review gate: ${nonRepStarted
          .map((asset) => asset.slotKey)
          .join(",")}`
      );
    }

    if (EXISTING_PROOF_KEYS.has(draftKey)) {
      if (
        character.stage !== "asset_plan_locked" &&
        character.stage !== "anchor_approved"
      ) {
        stop(`${draftKey} proof character stage=${character.stage}`);
      }
      if (
        rep.attempts !== 1 ||
        (rep.status !== "generated" && rep.status !== "approved") ||
        !rep.resultUrl
      ) {
        stop(`${draftKey} existing proof representative state drifted`);
      }
      const verdict = officialModerationVerdict(rep.moderation);
      if (verdict !== "clean" && verdict !== "adult_flagged") {
        stop(`${draftKey} existing proof moderation=${verdict}`);
      }
      continue;
    }

    if (draftKey === targetDraftKey) {
      if (
        character.stage !== "asset_plan_locked" ||
        rep.status !== "planned" ||
        rep.attempts !== 0 ||
        rep.resultUrl
      ) {
        stop(`${draftKey} target is not pristine asset_plan_locked/planned`);
      }
      continue;
    }

    if (character.stage === "anchor_approved") {
      if (
        rep.status !== "approved" ||
        rep.attempts !== 1 ||
        !rep.resultUrl
      ) {
        stop(`${draftKey} approved anchor state drifted`);
      }
      const verdict = officialModerationVerdict(rep.moderation);
      if (verdict !== "clean" && verdict !== "adult_flagged") {
        stop(`${draftKey} approved anchor moderation=${verdict}`);
      }
      previouslyApproved += 1;
      continue;
    }

    if (
      character.stage !== "asset_plan_locked" ||
      rep.status !== "planned" ||
      rep.attempts !== 0 ||
      rep.resultUrl
    ) {
      stop(
        `${draftKey} pending anchor is neither pristine nor already approved: stage=${character.stage}, status=${rep.status}, attempts=${rep.attempts}`
      );
    }
  }

  return { previouslyApproved, stageSnapshot };
}

async function main(): Promise<void> {
  const targetDraftKey = process.env[SINGLE_TARGET_ENV]?.trim() ?? "";
  if (!pilotClusterBStyleProofOptedIn() || !targetDraftKey) {
    console.log(
      `[rofan-v4-anchor-single] NOT_RUN: set OFFICIAL_STYLE_PROOF_LIVE=1, OFFICIAL_STYLE_PROOF_CANDIDATE=${PILOT_STYLE_PROOF_CANDIDATE_ID}, and ${SINGLE_TARGET_ENV}=pilot-rf-v4-XX`
    );
    return;
  }
  if (!ALLOWED_SINGLE_TARGETS.includes(targetDraftKey)) {
    stop(
      `target ${targetDraftKey} is not one of the remaining single-anchor drafts: ${ALLOWED_SINGLE_TARGETS.join(",")}`
    );
  }

  const store = new OfficialSupplyStore();
  const { previouslyApproved, stageSnapshot } = preflight(store, targetDraftKey);

  const deps = {
    store,
    transport: openAiOfficialImageTransport,
    imageOps: sharpOfficialImageOps,
    storage: uploadOfficialAssetStorage,
    spool: fileOfficialAssetSpool(),
    workerId: WORKER_ID,
    env: process.env,
  };

  const before = store.getAsset(targetDraftKey, PILOT_CLUSTER_B_PROOF_SLOT_KEY);
  if (before.attempts !== 0 || before.status !== "planned" || before.resultUrl) {
    stop(`${targetDraftKey}/rep is not pristine planned state`);
  }

  const outcome = await runOfficialAssetSlot(
    deps,
    targetDraftKey,
    PILOT_CLUSTER_B_PROOF_SLOT_KEY
  );
  if (outcome.status !== "generated") {
    stop(
      `${targetDraftKey} generation outcome=${outcome.status}${
        "error" in outcome ? `: ${outcome.error}` : ""
      }`
    );
  }

  let asset = store.getAsset(targetDraftKey, PILOT_CLUSTER_B_PROOF_SLOT_KEY);
  if (!asset.resultUrl) stop(`${targetDraftKey} has no representative result URL`);

  await moderateOfficialAssetSlot(
    { store, moderator: visionOfficialAssetModerator },
    targetDraftKey,
    PILOT_CLUSTER_B_PROOF_SLOT_KEY
  );
  asset = store.getAsset(targetDraftKey, PILOT_CLUSTER_B_PROOF_SLOT_KEY);

  const verdict = officialModerationVerdict(asset.moderation);
  if (verdict !== "clean" && verdict !== "adult_flagged") {
    stop(`${targetDraftKey} moderation=${verdict}`);
  }

  const anchor = {
    draftKey: targetDraftKey,
    name: store.getCharacter(targetDraftKey).draft.name,
    url: asset.resultUrl,
    width: asset.width,
    height: asset.height,
    model: asset.model,
    attempts: asset.attempts,
    spentUsd: asset.spentUsd,
    hasUnknownCost: asset.hasUnknownCost,
    moderation: asset.moderation,
  };

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

  const expectedStarted = EXISTING_PROOF_KEYS.size + previouslyApproved + 1;
  if (startedRows.length !== expectedStarted) {
    stop(
      `started asset count=${startedRows.length}; expected ${expectedStarted} (3 existing proofs + 1 approved single target)`
    );
  }
  for (const row of startedRows) {
    if (
      !(
        EXISTING_PROOF_KEYS.has(row.draft_key) ||
        row.draft_key === targetDraftKey ||
        stageSnapshot.get(row.draft_key) === "anchor_approved"
      ) ||
      row.slot_key !== PILOT_CLUSTER_B_PROOF_SLOT_KEY ||
      row.kind !== "representative" ||
      !(
        row.status === "generated" ||
        row.status === "approved"
      ) ||
      row.attempts !== 1
    ) {
      stop(
        `unexpected started asset ${row.draft_key}/${row.slot_key} kind=${row.kind} status=${row.status} attempts=${row.attempts}`
      );
    }
  }

  for (const draftKey of EXPECTED_DRAFT_KEYS) {
    const character = store.getCharacter(draftKey);
    const beforeStage = stageSnapshot.get(draftKey);
    if (character.stage !== beforeStage) {
      stop(
        `${draftKey} stage changed during image generation: ${beforeStage} -> ${character.stage}`
      );
    }
  }

  fs.mkdirSync(PACKET_DIR, { recursive: true });
  const packet = {
    status: "SINGLE_ANCHOR_GENERATED_AWAITING_HUMAN_REVIEW",
    styleKey: PILOT_STYLE_PROOF_V4_STYLE_KEY,
    styleStage: store.getStyle(PILOT_STYLE_PROOF_V4_STYLE_KEY).stage,
    batchKey: PILOT_STYLE_PROOF_V4_BATCH_KEY,
    targetDraftKey,
    existingProofAnchorsReused: EXISTING_PROOF_KEYS.size,
    previouslyApprovedSingleAnchors: previouslyApproved,
    newAnchorsGenerated: 1,
    anchor,
    rpSlotsStarted: 0,
    humanAnchorReviewRequired: true,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PACKET_PATH, `${JSON.stringify(packet, null, 2)}\n`, "utf8");

  console.log(`[rofan-v4-anchor-single] packet=${PACKET_PATH}`);
  console.log(JSON.stringify(packet));
}

main().catch((error) => {
  console.error(
    "[rofan-v4-anchor-single] STOP:",
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
  process.exit(1);
});
