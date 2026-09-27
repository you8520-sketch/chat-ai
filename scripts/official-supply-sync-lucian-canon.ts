import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { SessionUser } from "@/lib/characterFormSave";
import { officialModerationVerdict } from "@/lib/officialSupply/moderation";
import {
  buildPilotClusterBStyleProofDraft,
  PILOT_CLUSTER_B_PROOF_SLOT_KEY,
} from "@/lib/officialSupply/pilotClusterBStyleProof";
import { OfficialSupplyStore } from "@/lib/officialSupply/store";
import type {
  OfficialAppearanceLock,
  OfficialAssetPlan,
  OfficialCharacterDraft,
} from "@/lib/officialSupply/types";
import {
  PILOT_STYLE_PROOF_V4_BATCH_KEY,
  PILOT_STYLE_PROOF_V4_STYLE_KEY,
} from "@/lib/officialSupply/userOwnedRofanStyleRefs";

const LIVE_ENV = "OFFICIAL_LUCIAN_CANON_SYNC";
const SOURCE_DRAFT_KEY = "pilot-rf-03";
const TARGET_DRAFT_KEY = "pilot-rf-v4-03";
const EXPECTED_OLD_HEIGHT = 178;
const EXPECTED_NEW_HEIGHT = 184;
const EXPECTED_REP_URL_SUFFIX = "/uploads/official-pilot-rf-v4-03__rep-a1.webp";
const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");
const SOURCE_PATH = path.join(PILOT_DIR, "characters", `${SOURCE_DRAFT_KEY}.json`);
const STAGING_USER: SessionUser = {
  id: 0,
  nickname: "official-lucian-canon-sync",
  is_adult: 1,
};

type PilotCharacterFile = {
  draftKey: string;
  draft: OfficialCharacterDraft;
  appearance: OfficialAppearanceLock;
  assetPlan: OfficialAssetPlan;
};

function stop(message: string): never {
  throw new Error(`LUCIAN_CANON_SYNC STOP: ${message}`);
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

function normalizeHeightOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeHeightOnly);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key === "heightCm" && typeof nested === "number") {
        out[key] = "__HEIGHT_CM__";
      } else {
        out[key] = normalizeHeightOnly(nested);
      }
    }
    return out;
  }
  if (typeof value === "string") {
    return value.replace(/\b(?:178|184)cm\b/g, "__HEIGHT_CM__");
  }
  return value;
}

function snapshotOtherV4State(store: OfficialSupplyStore): string {
  const characters = store.database
    .prepare(
      `SELECT * FROM official_supply_characters
       WHERE style_key=? AND draft_key<>?
       ORDER BY draft_key`
    )
    .all(PILOT_STYLE_PROOF_V4_STYLE_KEY, TARGET_DRAFT_KEY);
  const assets = store.database
    .prepare(
      `SELECT a.*
       FROM official_supply_assets a
       JOIN official_supply_characters c ON c.draft_key=a.draft_key
       WHERE c.style_key=? AND c.draft_key<>?
       ORDER BY c.draft_key, a.id`
    )
    .all(PILOT_STYLE_PROOF_V4_STYLE_KEY, TARGET_DRAFT_KEY);
  return stable({ characters, assets });
}

function main(): void {
  if (process.env[LIVE_ENV] !== "1") {
    console.log(
      `[lucian-canon-sync] NOT_RUN: set ${LIVE_ENV}=1 for the one-shot canonical sync`
    );
    return;
  }

  const source = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8")) as PilotCharacterFile;
  if (
    source.draftKey !== SOURCE_DRAFT_KEY ||
    source.draft.draftKey !== SOURCE_DRAFT_KEY
  ) {
    stop("committed source identity drifted");
  }
  if (source.appearance.identity.heightCm !== EXPECTED_NEW_HEIGHT) {
    stop(
      `source appearance height=${source.appearance.identity.heightCm}; expected ${EXPECTED_NEW_HEIGHT}`
    );
  }
  if (!source.draft.sections.characterCore.includes("키: 184cm")) {
    stop("committed source draft does not contain the 184cm canonical core");
  }

  const nextDraft = buildPilotClusterBStyleProofDraft(source.draft);
  if (
    nextDraft.draftKey !== TARGET_DRAFT_KEY ||
    nextDraft.styleKey !== PILOT_STYLE_PROOF_V4_STYLE_KEY
  ) {
    stop("v4 draft transform drifted");
  }

  const store = new OfficialSupplyStore();
  const style = store.getStyle(PILOT_STYLE_PROOF_V4_STYLE_KEY);
  if (style.stage !== "style_locked") {
    stop(`style stage=${style.stage}; expected style_locked`);
  }

  const batch = store.getBatch(PILOT_STYLE_PROOF_V4_BATCH_KEY);
  if (batch.status !== "active") {
    stop(`batch status=${batch.status}: ${batch.pauseReason ?? ""}`);
  }

  const current = store.getCharacter(TARGET_DRAFT_KEY);
  if (current.batchKey !== PILOT_STYLE_PROOF_V4_BATCH_KEY) {
    stop(`target batch=${current.batchKey}`);
  }
  if (current.isStyleProof) {
    stop("Lucian must not be a style-proof character");
  }
  if (current.stage !== "asset_plan_locked") {
    stop(`target stage=${current.stage}; expected asset_plan_locked`);
  }
  if (!current.appearance || !current.assetPlan) {
    stop("target is missing appearance or asset plan");
  }
  if (current.appearance.identity.heightCm !== EXPECTED_OLD_HEIGHT) {
    stop(
      `current DB height=${current.appearance.identity.heightCm}; expected old value ${EXPECTED_OLD_HEIGHT}`
    );
  }
  if (!current.draft.sections.characterCore.includes("178cm")) {
    stop("current DB draft no longer contains expected old 178cm text");
  }

  const oldAppearanceNormalized = normalizeHeightOnly(current.appearance);
  const newAppearanceNormalized = normalizeHeightOnly(source.appearance);
  if (stable(oldAppearanceNormalized) !== stable(newAppearanceNormalized)) {
    stop("visual identity changed by more than the approved 178→184 height correction");
  }
  if (stable(current.assetPlan) !== stable(source.assetPlan)) {
    stop("asset plan changed; existing representative cannot be safely rebound");
  }

  const assets = store.listAssets(TARGET_DRAFT_KEY);
  if (assets.length !== source.assetPlan.slots.length || assets.length !== 14) {
    stop(`asset count=${assets.length}; expected 14`);
  }
  const rep = store.getAsset(TARGET_DRAFT_KEY, PILOT_CLUSTER_B_PROOF_SLOT_KEY);
  if (
    rep.kind !== "representative" ||
    rep.status !== "generated" ||
    rep.attempts !== 1 ||
    !rep.resultUrl ||
    !rep.resultUrl.endsWith(EXPECTED_REP_URL_SUFFIX) ||
    rep.hasUnknownCost ||
    rep.spentUsd <= 0 ||
    rep.qa
  ) {
    stop("existing representative is not the expected single unreviewed generated anchor");
  }
  const moderation = officialModerationVerdict(rep.moderation);
  if (moderation !== "clean" && moderation !== "adult_flagged") {
    stop(`existing representative moderation=${moderation}`);
  }
  const nonRepStarted = assets.filter(
    (asset) => asset.kind !== "representative" && asset.attempts > 0
  );
  if (nonRepStarted.length > 0) {
    stop(
      `RP assets already started: ${nonRepStarted.map((asset) => asset.slotKey).join(",")}`
    );
  }

  const preserved = {
    model: rep.model,
    providerRequestId: rep.providerRequestId,
    resultUrl: rep.resultUrl,
    width: rep.width,
    height: rep.height,
    spentUsd: rep.spentUsd,
    hasUnknownCost: rep.hasUnknownCost,
    moderation: rep.moderation,
  };
  if (!preserved.model || !preserved.width || !preserved.height || !preserved.moderation) {
    stop("representative provenance is incomplete");
  }

  const otherBefore = snapshotOtherV4State(store);

  store.updateDraft(TARGET_DRAFT_KEY, nextDraft);
  let record = store.getCharacter(TARGET_DRAFT_KEY);
  if (record.stage !== "draft") stop(`post-update stage=${record.stage}`);

  const textQa = store.lockText(TARGET_DRAFT_KEY, { stagingUser: STAGING_USER });
  if (!textQa.ok) stop(`TEXT_LOCK failed: ${JSON.stringify(textQa.errors)}`);
  record = store.getCharacter(TARGET_DRAFT_KEY);

  const appearanceQa = store.lockAppearance(TARGET_DRAFT_KEY, source.appearance);
  if (!appearanceQa.ok) {
    stop(`APPEARANCE_LOCK failed: ${JSON.stringify(appearanceQa.errors)}`);
  }
  record = store.getCharacter(TARGET_DRAFT_KEY);

  const planQa = store.lockAssetPlan(TARGET_DRAFT_KEY, source.assetPlan);
  if (!planQa.ok) stop(`ASSET_PLAN_LOCK failed: ${JSON.stringify(planQa.errors)}`);
  record = store.getCharacter(TARGET_DRAFT_KEY);

  if (
    record.stage !== "asset_plan_locked" ||
    record.appearance?.identity.heightCm !== EXPECTED_NEW_HEIGHT
  ) {
    stop(
      `relock post-condition failed: stage=${record.stage}, height=${record.appearance?.identity.heightCm}`
    );
  }

  const repAfterPlan = store.getAsset(TARGET_DRAFT_KEY, PILOT_CLUSTER_B_PROOF_SLOT_KEY);
  if (
    repAfterPlan.status !== "planned" ||
    repAfterPlan.attempts !== 0 ||
    repAfterPlan.resultUrl
  ) {
    stop("new representative row is not pristine after ASSET_PLAN_LOCK");
  }

  store.database
    .prepare(
      `UPDATE official_supply_assets
       SET status='generated',
           attempts=1,
           lease_owner=NULL,
           lease_expires_at=NULL,
           model=?,
           provider_request_id=?,
           result_url=?,
           width=?,
           height=?,
           spent_usd=?,
           has_unknown_cost=?,
           error=NULL,
           qa_json=NULL,
           moderation_json=?,
           updated_at=datetime('now')
       WHERE draft_key=? AND slot_key=? AND status='planned' AND attempts=0`
    )
    .run(
      preserved.model,
      preserved.providerRequestId,
      preserved.resultUrl,
      preserved.width,
      preserved.height,
      preserved.spentUsd,
      preserved.hasUnknownCost ? 1 : 0,
      JSON.stringify(preserved.moderation),
      TARGET_DRAFT_KEY,
      PILOT_CLUSTER_B_PROOF_SLOT_KEY
    );

  const rebound = store.getAsset(TARGET_DRAFT_KEY, PILOT_CLUSTER_B_PROOF_SLOT_KEY);
  if (
    rebound.status !== "generated" ||
    rebound.attempts !== 1 ||
    rebound.resultUrl !== preserved.resultUrl ||
    rebound.spentUsd !== preserved.spentUsd ||
    rebound.model !== preserved.model ||
    rebound.providerRequestId !== preserved.providerRequestId ||
    rebound.hasUnknownCost !== preserved.hasUnknownCost ||
    stable(rebound.moderation) !== stable(preserved.moderation)
  ) {
    stop("representative rebind did not preserve provenance exactly");
  }
  if (rebound.appearanceLockHash !== store.getCharacter(TARGET_DRAFT_KEY).appearanceLockHash) {
    stop("rebound representative does not carry the new appearance lock hash");
  }

  const afterAssets = store.listAssets(TARGET_DRAFT_KEY);
  const nonRepAfter = afterAssets.filter((asset) => asset.kind !== "representative");
  if (
    nonRepAfter.length !== 13 ||
    nonRepAfter.some(
      (asset) =>
        asset.status !== "planned" ||
        asset.attempts !== 0 ||
        asset.resultUrl !== null ||
        asset.spentUsd !== 0 ||
        asset.qa !== null ||
        asset.moderation !== null
    )
  ) {
    stop("one or more RP slots are not pristine after canonical relock");
  }

  if (!store.evaluateBatchPortfolio(PILOT_STYLE_PROOF_V4_BATCH_KEY).ok) {
    stop("batch portfolio QA failed after Lucian canonical sync");
  }

  const otherAfter = snapshotOtherV4State(store);
  if (otherAfter !== otherBefore) {
    stop("another v4 character or asset changed during Lucian sync");
  }

  const finalRecord = store.getCharacter(TARGET_DRAFT_KEY);
  console.log(
    JSON.stringify({
      status: "LUCIAN_CANON_SYNC_COMPLETE",
      draftKey: TARGET_DRAFT_KEY,
      stage: finalRecord.stage,
      canonicalHeightCm: finalRecord.appearance?.identity.heightCm,
      representativePreserved: rebound.resultUrl,
      representativeAttempts: rebound.attempts,
      representativeSpentUsd: rebound.spentUsd,
      rpSlotsStarted: nonRepAfter.filter((asset) => asset.attempts > 0).length,
      otherCharactersChanged: 0,
      anchorApprovalRequired: true,
    })
  );
}

try {
  main();
} catch (error) {
  console.error(
    "[lucian-canon-sync] STOP:",
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
  process.exit(1);
}
