import "server-only";

import { officialImageProfileForSlot } from "@/lib/officialSupply/imageProfile";
import { officialModerationVerdict } from "@/lib/officialSupply/moderation";
import { OfficialSupplyStore } from "@/lib/officialSupply/store";
import type { OfficialAnchorQaReport } from "@/lib/officialSupply/types";

const LIVE_ENV = "OFFICIAL_ANCHOR_APPROVAL_LIVE";
const TARGET_ENV = "OFFICIAL_ANCHOR_DRAFT_KEY";
const DECISION_ENV = "OFFICIAL_ANCHOR_REVIEW_DECISION";
const NOTE_ENV = "OFFICIAL_ANCHOR_REVIEW_NOTE";
const REVIEWER_ENV = "OFFICIAL_ANCHOR_REVIEWER";

function stop(message: string): never {
  throw new Error(`ANCHOR_APPROVAL STOP: ${message}`);
}

function humanApprovalQa(note: string): OfficialAnchorQaReport {
  const pass = { ok: true, note };
  return {
    gender: pass,
    ageAppearance: pass,
    face: pass,
    hair: pass,
    eyes: pass,
    body: pass,
    identifyingFeatures: pass,
    artStyle: pass,
    outfit: pass,
    cardCrop: pass,
  };
}

function main(): void {
  if (process.env[LIVE_ENV] !== "1") {
    console.log(
      `[official-anchor-approval] NOT_RUN: set ${LIVE_ENV}=1 with ${TARGET_ENV} and ${DECISION_ENV}=approve after human review`
    );
    return;
  }

  const draftKey = process.env[TARGET_ENV]?.trim() ?? "";
  const decision = process.env[DECISION_ENV]?.trim() ?? "";
  const reviewer = process.env[REVIEWER_ENV]?.trim() || "project-owner";
  const reviewNote =
    process.env[NOTE_ENV]?.trim() ||
    "Project owner visually approved this representative as the canonical anchor.";

  if (!draftKey) stop(`${TARGET_ENV} is required`);
  if (decision !== "approve") {
    stop(`${DECISION_ENV} must be exactly "approve"; got ${decision || "(empty)"}`);
  }
  if (!reviewer) stop("reviewer is required");

  const store = new OfficialSupplyStore();
  const character = store.getCharacter(draftKey);
  const representative = store.representativeAsset(draftKey);

  if (character.stage === "anchor_approved" && representative.status === "approved") {
    console.log(
      JSON.stringify({
        status: "ANCHOR_ALREADY_APPROVED",
        draftKey,
        stage: character.stage,
        resultUrl: representative.resultUrl,
        attempts: representative.attempts,
        spentUsd: representative.spentUsd,
      })
    );
    return;
  }

  const style = store.getStyle(character.styleKey);
  if (style.stage !== "style_locked") {
    stop(`style ${style.styleKey} stage=${style.stage}; style_locked required`);
  }
  if (character.stage !== "asset_plan_locked") {
    stop(`character stage=${character.stage}; asset_plan_locked required`);
  }
  if (!character.appearanceLockHash || !character.appearance) {
    stop("current appearance lock is missing");
  }
  if (
    representative.status !== "generated" ||
    representative.kind !== "representative" ||
    !representative.resultUrl ||
    representative.attempts < 1
  ) {
    stop(
      `representative state invalid: status=${representative.status}, attempts=${representative.attempts}, url=${representative.resultUrl ?? "(none)"}`
    );
  }
  if (representative.appearanceLockHash !== character.appearanceLockHash) {
    stop("representative predates the current appearance lock");
  }

  const profile = officialImageProfileForSlot("representative");
  if (
    representative.width !== profile.width ||
    representative.height !== profile.height
  ) {
    stop(
      `representative dimensions=${representative.width}x${representative.height}; expected ${profile.size}`
    );
  }

  const moderation = officialModerationVerdict(representative.moderation);
  if (moderation !== "clean" && moderation !== "adult_flagged") {
    stop(`representative moderation=${moderation}`);
  }
  if (!character.draft.adult.nsfw && moderation !== "clean") {
    stop("SFW character representative must have clean moderation");
  }

  const startedVariations = store
    .listAssets(draftKey)
    .filter((asset) => asset.kind !== "representative" && asset.attempts > 0);
  if (startedVariations.length > 0) {
    stop(
      `variation assets started before anchor approval: ${startedVariations
        .map((asset) => asset.slotKey)
        .join(",")}`
    );
  }

  const qa = humanApprovalQa(reviewNote);
  const result = store.reviewAnchor(draftKey, qa, reviewer);
  const after = store.getCharacter(draftKey);
  const afterRep = store.representativeAsset(draftKey);

  if (
    !result.approved ||
    after.stage !== "anchor_approved" ||
    afterRep.status !== "approved"
  ) {
    stop(
      `post-condition failed: approved=${result.approved}, stage=${after.stage}, rep=${afterRep.status}`
    );
  }

  const postStartedVariations = store
    .listAssets(draftKey)
    .filter((asset) => asset.kind !== "representative" && asset.attempts > 0);
  if (postStartedVariations.length > 0) {
    stop("anchor approval unexpectedly started variation generation");
  }

  console.log(
    JSON.stringify({
      status: "ANCHOR_APPROVAL_COMPLETE",
      draftKey,
      reviewer,
      stage: after.stage,
      representativeStatus: afterRep.status,
      resultUrl: afterRep.resultUrl,
      attempts: afterRep.attempts,
      spentUsd: afterRep.spentUsd,
      variationAttemptsStarted: 0,
    })
  );
}

try {
  main();
} catch (error) {
  console.error(
    "[official-anchor-approval] STOP:",
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
  process.exit(1);
}
